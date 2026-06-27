/**
 * One-time data migration: flat files → Supabase Postgres.
 *
 * Run from the app/ directory:
 *   cd app && npx tsx ../scripts/migrate-to-supabase.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SECRET_KEY in ../.env (project root).
 * Idempotent: uses upsert on all tables.
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";

// Load .env without the dotenv package (scripts/ has no node_modules)
const ENV_PATH = path.join(__dirname, "..", ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

const DATA_DIR = path.join(__dirname, "..", "data");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("❌  SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

function readJson<T>(file: string): T | null {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return null; }
}

function readCsv<T>(file: string): T[] {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  try {
    return parse(fs.readFileSync(p, "utf8"), { columns: true, bom: true, skip_empty_lines: true }) as T[];
  } catch { return []; }
}

async function upsertBatch(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  if (rows.length === 0) return;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const q = db.from(table).upsert(batch, onConflict ? { onConflict } : undefined);
    const { error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`  ✓ ${table} — ${rows.length} rows`);
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function configToRow(c: Record<string, string>) {
  return {
    id: c.id,
    config_name: c.configName,
    creators_category: c.creatorsCategory,
    analysis_instruction: c.analysisInstruction,
    new_concepts_instruction: c.newConceptsInstruction,
    created_at: c.createdAt || new Date().toISOString(),
  };
}

function creatorToRow(c: Record<string, string>) {
  return {
    id: c.id,
    username: c.username,
    category: c.category,
    profile_pic_url: c.profilePicUrl || null,
    followers: c.followers ? parseInt(c.followers) : null,
    reels_count_30d: c.reelsCount30d ? parseInt(c.reelsCount30d) : null,
    avg_views_30d: c.avgViews30d ? parseInt(c.avgViews30d) : null,
    last_scraped_at: c.lastScrapedAt || null,
    created_at: c.createdAt || new Date().toISOString(),
  };
}

function videoToRow(v: Record<string, string>) {
  return {
    id: v.id,
    link: v.link,
    thumbnail: v.thumbnail || null,
    creator: v.creator,
    views: v.views ? parseInt(v.views) : 0,
    likes: v.likes ? parseInt(v.likes) : 0,
    comments: v.comments ? parseInt(v.comments) : 0,
    analysis: v.analysis || null,
    new_concepts: v.newConcepts || null,
    date_posted: v.datePosted || null,
    date_added: v.dateAdded || null,
    config_name: v.configName || null,
    starred: v.starred === "true",
    created_at: v.createdAt || new Date().toISOString(),
  };
}

interface OfferTemplate {
  id: string; offerName: string; whatYouSell: string; valueProps: string[];
  tone: string; cta: string; proofPoints?: string; dosAndDonts?: string;
  isActive: boolean; createdAt: string;
}
function templateToRow(t: OfferTemplate) {
  return {
    id: t.id,
    offer_name: t.offerName,
    what_you_sell: t.whatYouSell,
    value_props: t.valueProps,
    tone: t.tone,
    cta: t.cta,
    proof_points: t.proofPoints || null,
    dos_and_donts: t.dosAndDonts || null,
    is_active: t.isActive,
    created_at: t.createdAt,
  };
}

interface ProspectList {
  id: string; name: string; createdAt: string;
  prospects: Record<string, unknown>[];
}
function listToRow(l: ProspectList) {
  return { id: l.id, name: l.name, created_at: l.createdAt };
}

function prospectToRow(p: Record<string, unknown>, listId: string) {
  const num = (v: unknown) => (v != null && v !== "" ? Number(v) : null);
  return {
    id: p.id, list_id: listId,
    full_name: p.fullName || null, first_name: p.firstName || null,
    headline: p.headline || null, company: p.company || null,
    job_title: p.jobTitle || null, location: p.location || null,
    profile_url: p.profileUrl || null, email: p.email || null,
    phone: p.phone || null, address: p.address || null,
    website: p.website || null, bio: p.bio || null,
    followers: p.followers || null, reviews_raw: p.reviewsRaw || null,
    rating: num(p.rating), review_count: num(p.reviewCount),
    price_range: p.priceRange || null,
    business_category: p.businessCategory || null,
    priority_score: num(p.priorityScore), priority_level: p.priorityLevel || null,
    review_summary: p.reviewSummary || null,
    website_status: p.websiteStatus || null, outreach_angle: p.outreachAngle || null,
    lead_status: p.leadStatus || "new", analysis_status: p.analysisStatus || "idle",
    draft_status: p.draftStatus || "idle",
    linkedin_message: p.linkedinMessage || null, email_message: p.emailMessage || null,
    whatsapp_message: p.whatsappMessage || null,
    cold_call_notes: p.coldCallNotes || null,
    custom_notes: (p.customNotes as string) || '', source: p.source || null,
    price_quoted: num(p.priceQuoted), price_confirmed: num(p.priceConfirmed),
    last_analyzed_at: p.lastAnalyzedAt || null, last_drafted_at: p.lastDraftedAt || null,
    last_contacted_at: p.lastContactedAt || null, follow_up_date: p.followUpDate || null,
    created_at: (p.createdAt as string) || new Date().toISOString(),
  };
}

interface ClipJob { id: string; [k: string]: unknown }
function clipJobToRow(j: ClipJob) {
  return {
    id: j.id,
    source_url: j.sourceUrl || null, source_title: j.sourceTitle || null,
    source_duration_sec: j.sourceDurationSec || null,
    clip_model: j.clipModel || null, clip_length_mode: j.clipLengthMode || null,
    speech_language: j.speechLanguage || null,
    range_start_sec: j.rangeStartSec ?? 0, range_end_sec: j.rangeEndSec ?? 0,
    include_moments_prompt: j.includeMoments || j.includeMomentsPrompt || null,
    status: j.status || "queued", errors: j.errors || null,
    progress: j.progress || null,
    created_at: (j.createdAt as string) || new Date().toISOString(),
  };
}

interface Clip { id: string; jobId: string; [k: string]: unknown }
function clipToRow(c: Clip) {
  return {
    id: c.id, job_id: c.jobId,
    rank: c.rank || null, title: c.title || null,
    start_sec: c.start ?? 0, end_sec: c.end ?? 0,
    duration_sec: c.durationSec || null, score: c.score || 0,
    hook: c.hook || null, hook_type: c.hookType || null,
    genre: c.genre || null, reason: c.reason || null,
    transcript: c.transcript || null, file_path: c.filePath || null,
    thumbnail: c.thumbnail || null, caption: c.caption || null,
    starred: c.starred === true || c.starred === "true",
    public_url: c.publicUrl || null,
    created_at: (c.createdAt as string) || new Date().toISOString(),
  };
}

interface SocialAccount { id: string; [k: string]: unknown }
function accountToRow(a: SocialAccount) {
  return {
    id: a.id, platform: a.platform,
    display_name: a.displayName || null, username: a.username || null,
    avatar_url: a.avatarUrl || null, access_token: a.accessToken || null,
    ig_user_id: a.igUserId || null, page_id: a.pageId || null,
    expires_at: a.expiresAt || null,
    connected_at: (a.connectedAt as string) || new Date().toISOString(),
  };
}

interface ScheduledPost { id: string; [k: string]: unknown }
function postToRow(p: ScheduledPost) {
  return {
    id: p.id, clip_id: p.clipId, account_id: p.accountId,
    caption: (p.caption as string) || '', scheduled_for: p.scheduledFor || null,
    status: p.status || "draft", error: p.error || null,
    created_at: (p.createdAt as string) || new Date().toISOString(),
  };
}

interface CaptionTemplate { id: string; [k: string]: unknown }
function captionTemplateToRow(t: CaptionTemplate) {
  return {
    id: t.id, name: t.name,
    config: t.config || null,
    created_at: (t.createdAt as string) || new Date().toISOString(),
  };
}

interface CaptionPromptTemplate { id: string; [k: string]: unknown }
function captionPromptTemplateToRow(t: CaptionPromptTemplate) {
  return {
    id: t.id, name: t.name,
    creator: t.creator || null, context: t.context || null,
    brand_voice: t.brandVoice || null, cta: t.cta || null,
    hashtags: t.hashtags || null, include_hashtags: t.includeHashtags ?? true,
    created_at: (t.createdAt as string) || new Date().toISOString(),
    updated_at: (t.updatedAt as string) || new Date().toISOString(),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀  Starting migration to Supabase…\n");

  // 1. Configs
  const configs = readCsv<Record<string, string>>("configs.csv");
  await upsertBatch("configs", configs.map(configToRow), "id");

  // 2. Creators
  const creators = readCsv<Record<string, string>>("creators.csv");
  await upsertBatch("creators", creators.map(creatorToRow), "id");

  // 3. Videos
  const videos = readCsv<Record<string, string>>("videos.csv");
  await upsertBatch("videos", videos.map(videoToRow), "id");

  // 4. Offer templates
  const templates = readJson<OfferTemplate[]>("offer-templates.json") ?? [];
  await upsertBatch("offer_templates", templates.map(templateToRow), "id");

  // 5. Prospect lists + prospects (in dependency order)
  const lists = readJson<ProspectList[]>("outreach-lists.json") ?? [];
  await upsertBatch("prospect_lists", lists.map(listToRow), "id");
  const allProspects = lists.flatMap((l) => l.prospects.map((p) => prospectToRow(p as Record<string, unknown>, l.id)));
  await upsertBatch("prospects", allProspects, "id");

  // 6. Clip jobs
  const jobs = readJson<ClipJob[]>("clip-jobs.json") ?? [];
  await upsertBatch("clip_jobs", jobs.map(clipJobToRow), "id");

  // 7. Clips
  const clips = readCsv<Record<string, unknown>>("clips.csv");
  await upsertBatch("clips", clips.map((c) => clipToRow(c as Clip)), "id");

  // 8. Clip edits
  const editsDir = path.join(DATA_DIR, "clip-edits");
  if (fs.existsSync(editsDir)) {
    const editRows = fs.readdirSync(editsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const clipId = path.basename(f, ".json");
        const doc = JSON.parse(fs.readFileSync(path.join(editsDir, f), "utf8"));
        return { clip_id: clipId, job_id: doc.jobId || null, doc, updated_at: doc.updatedAt || new Date().toISOString() };
      });
    await upsertBatch("clip_edits", editRows, "clip_id");
  }

  // 9. Clip transcripts
  const transcriptsDir = path.join(DATA_DIR, "clip-transcripts");
  if (fs.existsSync(transcriptsDir)) {
    const transcriptRows = fs.readdirSync(transcriptsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const jobId = path.basename(f, ".json");
        const words = JSON.parse(fs.readFileSync(path.join(transcriptsDir, f), "utf8"));
        return { job_id: jobId, words, created_at: new Date().toISOString() };
      });
    await upsertBatch("clip_transcripts", transcriptRows, "job_id");
  }

  // 10. Social accounts
  const accounts = readJson<SocialAccount[]>("social-accounts.json") ?? [];
  await upsertBatch("social_accounts", accounts.map(accountToRow), "id");

  // 11. Scheduled posts (filter to only posts with valid account + clip references)
  const posts = readJson<ScheduledPost[]>("scheduled-posts.json") ?? [];
  const validAccountIds = new Set(accounts.map((a) => a.id));
  const validClipIds = new Set((readCsv<Record<string, unknown>>("clips.csv") as Clip[]).map((c) => c.id));
  const validPosts = posts.filter((p) => validAccountIds.has(p.accountId as string) && validClipIds.has(p.clipId as string));
  if (posts.length !== validPosts.length) console.log(`  ⚠ Skipped ${posts.length - validPosts.length} scheduled posts with missing account/clip refs`);
  await upsertBatch("scheduled_posts", validPosts.map(postToRow), "id");

  // 12. Caption templates
  const captionTemplates = readJson<CaptionTemplate[]>("caption-templates.json") ?? [];
  await upsertBatch("caption_templates", captionTemplates.map(captionTemplateToRow), "id");

  // 13. Caption prompt templates
  const captionPromptTemplates = readJson<CaptionPromptTemplate[]>("caption-prompt-templates.json") ?? [];
  await upsertBatch("caption_prompt_templates", captionPromptTemplates.map(captionPromptTemplateToRow), "id");

  // 14. App settings (non-secret prefs from settings.json, camelCase → snake_case)
  const settings = readJson<Record<string, unknown>>("settings.json");
  if (settings) {
    const SECRET_FIELDS = new Set(["openaiApiKey", "openrouterApiKey", "apifyApiToken", "deepgramApiKey", "assemblyaiApiKey", "metaAppId", "metaAppSecret", "ytDlpCookiesText"]);
    const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const SCHEMA_COLS = new Set(["provider","openrouter_model","gemini_model","linkedin_char_limit","email_length_guidance","whatsapp_char_limit","sender_name","default_location_label","transcription_provider","default_caption_preset","default_aspect_ratio","default_clip_length","yt_dlp_cookies_browser","yt_dlp_cookies_text","enable_social_publish","editor_shortcuts"]);
    const prefs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (SECRET_FIELDS.has(k)) continue;
      const col = camelToSnake(k);
      if (SCHEMA_COLS.has(col)) prefs[col] = v;
    }
    await upsertBatch("app_settings", [{ id: 1, ...prefs }], "id");
  }

  console.log("\n✅  Migration complete!");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
