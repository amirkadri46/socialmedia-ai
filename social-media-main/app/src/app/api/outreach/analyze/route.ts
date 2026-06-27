import OpenAI from "openai";
import { repos } from "@/lib/db";
import { buildLlmClient, parseJsonResponse } from "@/lib/llm-client";
import { levelFromScore } from "@/lib/lead-scoring";
import type { Prospect, OfferTemplate, ColdCallNotes, WebsiteStatus } from "@/lib/types";

export const maxDuration = 300;

interface AnalyzeBody {
  listId: string;
  prospectIds?: string[];
  regenerate?: boolean;
  messagesOnly?: boolean; // skip Phase 1 (scoring) and only (re)generate outreach messages
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

// One-shot SSE error: emit a `phase:"error"` event the client's stream reader
// understands (it never inspects the HTTP status), so failures aren't reported
// as a successful "Analysis complete".
function sseError(error: string): Response {
  return new Response(`data: ${JSON.stringify({ phase: "error", error })}\n\n`, {
    headers: SSE_HEADERS,
  });
}

const VALID_WEBSITE_STATUS: ReadonlySet<WebsiteStatus> = new Set<WebsiteStatus>([
  "has_website",
  "no_website",
  "social_only",
  "unknown",
]);

// ── Prompt builders ──────────────────────────────────────────────────────────

function businessLines(p: Prospect): string {
  return [
    p.company && `Business name: ${p.company}`,
    p.businessCategory && `Category: ${p.businessCategory}`,
    p.rating != null && `Rating: ${p.rating} / 5`,
    p.reviewCount != null && `Review count: ${p.reviewCount}`,
    p.priceRange && `Price range: ${p.priceRange}`,
    p.website ? `Website: ${p.website}` : `Website: (none found)`,
    p.address && `Address: ${p.address}`,
    p.location && `Location: ${p.location}`,
    p.phone && `Phone: ${p.phone}`,
    p.email && `Email: ${p.email}`,
    p.reviewsRaw && `Reviews (raw):\n${p.reviewsRaw.slice(0, 2000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function analysisPrompt(p: Prospect): string {
  return `You are a B2B lead-intelligence analyst scoring local businesses as outreach prospects for a website/marketing agency.

=== BUSINESS ===
${businessLines(p) || "No business data available."}

=== SCORING RUBRIC (produce a 0–100 priorityScore) ===
- Review count: more reviews → higher (social proof / established).
- Rating: 4.5+ → higher.
- Price range: premium ($$$ / $$$$) → higher (budget for services).
- Website availability: HAS a website → higher; NO website → lower (less established) — BUT note this is the strongest outreach angle for a web/design offer.
- Service type: high-ticket services score higher (clinics, dentists, architects, real estate, law firms, agencies, cosmetic/medical, contractors).

Return ONLY valid JSON, no markdown fences:
{
  "priorityScore": <integer 0-100>,
  "businessCategory": "<normalized human category, e.g. 'Dental Clinic'>",
  "reviewSummary": "<1-2 sentence summary of review sentiment/themes; if no reviews, say so>",
  "websiteStatus": "has_website" | "no_website" | "social_only" | "unknown",
  "outreachAngle": "<the single most compelling hook to lead with; if no website, surface that prominently>"
}`;
}

function generationPrompt(
  p: Prospect,
  template: OfferTemplate,
  opts: { senderName: string; locationFallback: string; whatsappCharLimit: number }
): string {
  const valueProps = template.valueProps.join("\n- ");
  const location = p.location || opts.locationFallback || "your area";
  const firstName = p.firstName || p.fullName || "there";
  return `You are a cold-outreach specialist for ${template.offerName}.

=== OFFER CONTEXT (fixed) ===
What we sell: ${template.whatYouSell}
Value propositions:
- ${valueProps}
Tone: ${template.tone}
CTA: ${template.cta}
${template.proofPoints ? `Proof/results: ${template.proofPoints}` : ""}
${template.dosAndDonts ? `Dos & Don'ts: ${template.dosAndDonts}` : ""}
Sender name (sign emails with this): ${opts.senderName || "(unsigned)"}

=== LEAD ===
${businessLines(p) || "No business data available."}
First name to address: ${firstName}
Location to reference: ${location}

=== AI ANALYSIS (already computed) ===
Priority: ${p.priorityScore ?? "?"} (${p.priorityLevel ?? "?"})
Website status: ${p.websiteStatus ?? "unknown"}
Outreach angle to lead with: ${p.outreachAngle ?? "(none)"}
Review summary: ${p.reviewSummary ?? "(none)"}

=== OUTPUT RULES ===
whatsappMessage (≤${opts.whatsappCharLimit} characters):
- Short, warm, human. Reference a REAL detail (rating/reviews/category/location).
- Soft CTA. No greeting fluff like "Hope you're well". No emojis unless the tone says so.

emailMessage:
- Open on the prospect's world (NOT "Hi, I'm X from Y").
- ~80–130 words, conversational and direct, concrete over generic.
- Low-friction question-style CTA. Sign off with "${opts.senderName || "the sender"}".

coldCallNotes: a structured brief for a phone call.

Return ONLY valid JSON, no markdown fences:
{
  "whatsappMessage": "...",
  "emailMessage": "...",
  "coldCallNotes": {
    "businessType": "...",
    "reviewCount": ${p.reviewCount ?? 0},
    "rating": ${p.rating ?? 0},
    "keyStrength": "...",
    "keyWeakness": "...",
    "talkingPoints": ["...", "...", "..."]
  }
}`;
}

// ── LLM calls ────────────────────────────────────────────────────────────────

interface AnalysisOut {
  priorityScore: number;
  businessCategory: string;
  reviewSummary: string;
  websiteStatus: WebsiteStatus;
  outreachAngle: string;
}

async function analyzeLead(p: Prospect, client: OpenAI, model: string): Promise<Partial<Prospect>> {
  const res = await client.chat.completions.create({
    model,
    max_tokens: 700,
    temperature: 0.4,
    messages: [{ role: "user", content: analysisPrompt(p) }],
  });
  const raw = res.choices[0]?.message?.content ?? "";
  const parsed = parseJsonResponse<AnalysisOut>(raw);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.priorityScore) || 0)));
  // Deterministic website fallback if model is unsure or returns an off-spec value.
  let websiteStatus = parsed.websiteStatus;
  if (!websiteStatus || websiteStatus === "unknown" || !VALID_WEBSITE_STATUS.has(websiteStatus)) {
    websiteStatus = p.website ? "has_website" : "no_website";
  }
  return {
    priorityScore: score,
    priorityLevel: levelFromScore(score),
    businessCategory: parsed.businessCategory || p.businessCategory,
    reviewSummary: parsed.reviewSummary || "",
    websiteStatus,
    outreachAngle: parsed.outreachAngle || "",
    lastAnalyzedAt: new Date().toISOString(),
  };
}

interface GenerationOut {
  whatsappMessage: string;
  emailMessage: string;
  coldCallNotes: ColdCallNotes;
}

async function generateMessages(
  p: Prospect,
  template: OfferTemplate,
  client: OpenAI,
  model: string,
  opts: { senderName: string; locationFallback: string; whatsappCharLimit: number }
): Promise<Partial<Prospect>> {
  const res = await client.chat.completions.create({
    model,
    max_tokens: 1200,
    temperature: 0.8,
    messages: [{ role: "user", content: generationPrompt(p, template, opts) }],
  });
  const raw = res.choices[0]?.message?.content ?? "";
  const parsed = parseJsonResponse<GenerationOut>(raw);
  return {
    whatsappMessage: parsed.whatsappMessage ?? "",
    emailMessage: parsed.emailMessage ?? "",
    coldCallNotes: normalizeColdCallNotes(parsed.coldCallNotes, p),
    lastDraftedAt: new Date().toISOString(),
  };
}

// Guarantee a well-formed ColdCallNotes so the UI never reads `undefined.talkingPoints`.
function normalizeColdCallNotes(notes: Partial<ColdCallNotes> | undefined, p: Prospect): ColdCallNotes {
  const n = notes ?? {};
  return {
    businessType: n.businessType || p.businessCategory || p.company || "",
    reviewCount: typeof n.reviewCount === "number" ? n.reviewCount : p.reviewCount ?? 0,
    rating: typeof n.rating === "number" ? n.rating : p.rating ?? 0,
    keyStrength: n.keyStrength || "",
    keyWeakness: n.keyWeakness || "",
    talkingPoints: Array.isArray(n.talkingPoints) ? n.talkingPoints.filter((t) => typeof t === "string") : [],
  };
}

// ── Route ──────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return sseError("Invalid JSON in request body.");
  }
  const { listId, prospectIds, regenerate, messagesOnly } = body;

  const settings = await repos.settings.get();
  const template = await repos.offerTemplates.getActive();

  let client: OpenAI;
  let model: string;
  try {
    ({ client, model } = buildLlmClient(settings));
  } catch (err) {
    return sseError(err instanceof Error ? err.message : String(err));
  }

  const list = await repos.prospects.getList(listId);
  if (!list) return sseError("List not found.");
  if (!template) {
    return sseError("No active offer template — go to Outreach › Templates.");
  }

  // Which prospects to process
  const idSet = prospectIds?.length ? new Set(prospectIds) : null;
  const targets = list.prospects.filter((p) => {
    if (idSet) return idSet.has(p.id);
    if (regenerate) return true;
    return p.analysisStatus !== "done"; // skip already-analyzed unless regenerate
  });
  const total = targets.length;

  const opts = {
    senderName: settings.senderName || "",
    locationFallback: settings.defaultLocationLabel || "",
    whatsappCharLimit: settings.whatsappCharLimit ?? 600,
  };
  const CONCURRENCY = 3;

  const encoder = new TextEncoder();
  let gone = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          gone = true;
        }
      };

      // Persist helper — one batch write per call (single file write / single DB upsert).
      const persist = async (patches: Map<string, Partial<Prospect>>) => {
        const updated = [...patches.keys()].flatMap((id) => {
          const p = targets.find((t) => t.id === id);
          return p ? [p] : [];
        });
        if (updated.length) await repos.prospects.upsertProspects(listId, updated);
      };

      try {
        if (total === 0) {
          send({ phase: "done", completed: 0, total: 0 });
          return;
        }

        // ── Phase 1: analyze ──
        let completed = 0;
        if (messagesOnly) {
          // Skip scoring — the client shows the Analyzing line as already complete.
          send({ phase: "analyzing", completed: total, total });
        } else {
          for (let i = 0; i < targets.length && !gone; i += CONCURRENCY) {
            const batch = targets.slice(i, i + CONCURRENCY);
            const patches = new Map<string, Partial<Prospect>>();
            await Promise.all(
              batch.map(async (p) => {
                try {
                  const patch = await analyzeLead(p, client, model);
                  Object.assign(p, patch, { analysisStatus: "done" as const });
                  patches.set(p.id, { ...patch, analysisStatus: "done" });
                } catch {
                  p.analysisStatus = "error";
                  patches.set(p.id, { analysisStatus: "error" });
                }
              })
            );
            await persist(patches);
            completed += batch.length;
            for (const p of batch) {
              send({ phase: "analyzing", completed, total, lastId: p.id, lead: p });
            }
          }
        }

        // ── Phase 2: generate messages ──
        completed = 0;
        // When messagesOnly, callers skip Phase 1, so unanalyzed prospects have no
        // outreachAngle/websiteStatus — skip them to avoid garbage LLM output.
        const phase2Targets = messagesOnly
          ? targets.filter((p) => p.analysisStatus === "done")
          : targets;
        for (let i = 0; i < phase2Targets.length && !gone; i += CONCURRENCY) {
          const batch = phase2Targets.slice(i, i + CONCURRENCY);
          const patches = new Map<string, Partial<Prospect>>();
          await Promise.all(
            batch.map(async (p) => {
              try {
                const patch = await generateMessages(p, template, client, model, opts);
                Object.assign(p, patch, { draftStatus: "done" as const });
                patches.set(p.id, { ...patch, draftStatus: "done" });
              } catch {
                patches.set(p.id, { draftStatus: "error" });
                p.draftStatus = "error";
              }
            })
          );
          await persist(patches);
          completed += batch.length;
          for (const p of batch) {
            send({ phase: "generating", completed, total, lastId: p.id, lead: p });
          }
        }

        send({ phase: "done", completed: total, total });
      } catch (err) {
        send({ phase: "error", error: err instanceof Error ? err.message : "Analysis failed" });
      } finally {
        try { controller.close(); } catch { /* closed */ }
      }
    },
    cancel() {
      gone = true;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
