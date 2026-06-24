import { NextResponse } from "next/server";
import OpenAI from "openai";
import { readSettings } from "@/lib/settings";
import { buildLlmClient, parseJsonResponse } from "@/lib/llm-client";
import { readProspectLists, writeProspectLists, getActiveTemplate } from "@/lib/outreach";
import type { Prospect, OfferTemplate } from "@/lib/types";

export const maxDuration = 120;

interface DraftResult {
  id: string;
  linkedinMessage?: string;
  emailMessage?: string;
  error?: string;
}

function buildPrompt(prospect: Prospect, template: OfferTemplate, charLimit: number): string {
  const valueProps = template.valueProps.join("\n- ");
  const prospectLines = [
    prospect.fullName && `Name: ${prospect.fullName}`,
    prospect.headline && `Headline: ${prospect.headline}`,
    prospect.company && `Company: ${prospect.company}`,
    prospect.location && `Location: ${prospect.location}`,
    prospect.bio && `Bio: ${prospect.bio}`,
    prospect.website && `Website: ${prospect.website}`,
    prospect.followers && `Followers/Connections: ${prospect.followers}`,
    prospect.email && `Email: ${prospect.email}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a cold-outreach specialist for a website design agency.

=== OFFER CONTEXT (fixed) ===
What we sell: ${template.whatYouSell}
Value propositions:
- ${valueProps}
Tone: ${template.tone}
CTA: ${template.cta}
${template.proofPoints ? `Proof/results: ${template.proofPoints}` : ""}
${template.dosAndDonts ? `Dos & Don'ts: ${template.dosAndDonts}` : ""}

=== PROSPECT ===
${prospectLines || "No scraped fields available."}

=== USER NOTES (highest priority signal) ===
${prospect.customNotes || "(no notes)"}

=== OUTPUT RULES ===
LinkedIn DM (≤${charLimit} characters total — this is a hard limit):
- No "Hope you're well" or any greeting fluff
- Reference ONE specific, real detail about this prospect
- Lead with value, not with who you are
- End with ONE soft CTA
- Sound human, not like a pitch bot
- No emojis unless tone says so

Cold email:
- Do NOT open with "Hi, I'm [name] from [agency]" — start on the prospect's world
- Conversational and direct
- Clearly state the specific way website design helps their situation
- Concrete over generic
- ~80–130 words
- End with a low-friction question-style CTA (not "Let me know if you're interested")

Return ONLY valid JSON with no markdown fences:
{"linkedinMessage": "...", "emailMessage": "..."}`;
}

async function draftOne(
  prospect: Prospect,
  template: OfferTemplate,
  client: OpenAI,
  model: string,
  charLimit: number
): Promise<DraftResult> {
  const prompt = buildPrompt(prospect, template, charLimit);

  let linkedinMessage = "";
  let emailMessage = "";

  try {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      temperature: 0.8,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = parseJsonResponse<{ linkedinMessage: string; emailMessage: string }>(raw);
    linkedinMessage = parsed.linkedinMessage ?? "";
    emailMessage = parsed.emailMessage ?? "";

    // Hard-trim LinkedIn message if over limit
    if (linkedinMessage.length > charLimit) {
      // One retry with stricter instruction
      const strictPrompt = `${prompt}\n\nIMPORTANT: Your previous LinkedIn message was too long. The HARD LIMIT is ${charLimit} characters. The message MUST be ${charLimit} characters or fewer. Return only the JSON object.`;
      const retryResponse = await client.chat.completions.create({
        model,
        max_tokens: 512,
        temperature: 0.7,
        messages: [{ role: "user", content: strictPrompt }],
      });
      const retryRaw = retryResponse.choices[0]?.message?.content ?? "";
      try {
        const retryParsed = parseJsonResponse<{ linkedinMessage: string; emailMessage: string }>(retryRaw);
        // Use != null so an empty string is accepted (not treated as missing)
        // Don't overwrite emailMessage — the retry is only for shortening the LinkedIn message
        if (retryParsed.linkedinMessage != null) linkedinMessage = retryParsed.linkedinMessage;
      } catch {
        // Keep original; hard-trim as last resort
        linkedinMessage = linkedinMessage.slice(0, charLimit);
      }
      // Final safety trim
      if (linkedinMessage.length > charLimit) {
        linkedinMessage = linkedinMessage.slice(0, charLimit);
      }
    }

    return { id: prospect.id, linkedinMessage, emailMessage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id: prospect.id, error: msg };
  }
}

export async function POST(req: Request) {
  const { prospects, listId } = (await req.json()) as {
    prospects: Prospect[];
    listId: string;
  };

  if (!prospects?.length) {
    return NextResponse.json({ error: "No prospects provided" }, { status: 400 });
  }

  const settings = readSettings();
  const charLimit = settings.linkedinCharLimit ?? 200;
  const template = getActiveTemplate();
  if (!template) {
    return NextResponse.json(
      { error: "No active offer template — go to Outreach › Templates to set one up." },
      { status: 400 }
    );
  }

  let client: OpenAI;
  let model: string;
  try {
    ({ client, model } = buildLlmClient(settings));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Process in batches of 3 to respect rate limits
  const CONCURRENCY = 3;
  const results: DraftResult[] = [];
  for (let i = 0; i < prospects.length; i += CONCURRENCY) {
    const batch = prospects.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((p) => draftOne(p, template, client, model, charLimit))
    );
    results.push(...batchResults);
  }

  // Persist results back to the list file
  if (listId) {
    const lists = readProspectLists();
    const list = lists.find((l) => l.id === listId);
    if (list) {
      for (const result of results) {
        const prospect = list.prospects.find((p) => p.id === result.id);
        if (prospect) {
          if (result.error) {
            prospect.draftStatus = "error";
          } else {
            prospect.linkedinMessage = result.linkedinMessage;
            prospect.emailMessage = result.emailMessage;
            prospect.draftStatus = "done";
            prospect.lastDraftedAt = new Date().toISOString();
          }
        }
      }
      writeProspectLists(lists);
    }
  }

  return NextResponse.json({ results });
}
