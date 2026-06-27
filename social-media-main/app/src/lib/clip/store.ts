import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from "fs";
import path from "path";
import type {
  ClipJob,
  Clip,
  SocialAccount,
  ScheduledPost,
  Word,
  ClipEdit,
  CaptionTemplate,
  CaptionPromptTemplate,
  ClipProgress,
} from "../types";
import { presetToCaptionConfig } from "./caption-styles";

// ── Paths ───────────────────────────────────────────────────────────────────────
// Mirrors lib/csv.ts + lib/outreach.ts: data lives in the repo-root data/ dir.

const DATA_DIR = path.join(process.cwd(), "..", "data");
const CLIP_DIR = path.join(DATA_DIR, "clips"); // rendered mp4s + thumbnails
const JOBS_PATH = path.join(DATA_DIR, "clip-jobs.json");
const CLIPS_PATH = path.join(DATA_DIR, "clips.csv");
const ACCOUNTS_PATH = path.join(DATA_DIR, "social-accounts.json");
const POSTS_PATH = path.join(DATA_DIR, "scheduled-posts.json");
const EDITS_DIR = path.join(DATA_DIR, "clip-edits");
const TRANSCRIPTS_DIR = path.join(DATA_DIR, "clip-transcripts");
const CAPTION_TEMPLATES_PATH = path.join(DATA_DIR, "caption-templates.json");
const CAPTION_PROMPT_TEMPLATES_PATH = path.join(DATA_DIR, "caption-prompt-templates.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Atomic write: write to a temp file then rename over the target. rename() is atomic on
 * the same filesystem, so concurrent readers never observe a half-written file and a
 * crash mid-write can't corrupt the existing data. Used for the JSON/CSV stores that
 * multiple routes (schedule, publish, pipeline) may write near-simultaneously.
 */
function writeFileAtomic(p: string, data: string): void {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, data, "utf-8");
  try {
    renameSync(tmp, p);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

export function clipMediaDir(): string {
  if (!existsSync(CLIP_DIR)) mkdirSync(CLIP_DIR, { recursive: true });
  return CLIP_DIR;
}

/**
 * Persistent path for the source video of a job (survives temp-dir clears and
 * server restarts). The editor routes check this first before the temp dir.
 */
export function persistentSourcePath(jobId: string): string {
  if (!existsSync(CLIP_DIR)) mkdirSync(CLIP_DIR, { recursive: true });
  return path.join(CLIP_DIR, `source-${jobId}.mp4`);
}

/** Per-clip assets dir (uploaded media/b-roll/audio) under data/clips/assets/{clipId}. */
export function clipAssetsDir(clipId: string): string {
  const dir = path.join(CLIP_DIR, "assets", clipId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Jobs (JSON) ──────────────────────────────────────────────────────────────────

export function readJobs(): ClipJob[] {
  if (!existsSync(JOBS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(JOBS_PATH, "utf-8")) as ClipJob[];
  } catch {
    return [];
  }
}

export function writeJobs(jobs: ClipJob[]): void {
  ensureDataDir();
  writeFileAtomic(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

export function upsertJob(job: ClipJob): void {
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.unshift(job);
  writeJobs(jobs);
}

export function getJob(jobId: string): ClipJob | undefined {
  return readJobs().find((j) => j.id === jobId);
}

// ── Live progress + cancellation (in-memory, process-scoped) ──────────────────────
// A running pipeline is detached from the HTTP request, so its live progress (percent,
// logs, ETA) lives here for the life of the process — letting a client that navigated
// away and came back re-attach and keep watching. Cancellation is the ONLY thing that
// stops a job: the pipeline polls isCancelRequested() between steps.

const progressByJob = new Map<string, ClipProgress>();
const cancelRequested = new Set<string>();

export function setLiveProgress(jobId: string, progress: ClipProgress): void {
  progressByJob.set(jobId, progress);
}

export function getLiveProgress(jobId: string): ClipProgress | undefined {
  return progressByJob.get(jobId);
}

export function clearLiveProgress(jobId: string): void {
  progressByJob.delete(jobId);
}

export function requestCancel(jobId: string): void {
  cancelRequested.add(jobId);
}

export function isCancelRequested(jobId: string): boolean {
  return cancelRequested.has(jobId);
}

export function clearCancel(jobId: string): void {
  cancelRequested.delete(jobId);
}

// ── Clips (CSV, mirroring lib/csv.ts videos handling) ─────────────────────────────

const CLIP_COLUMNS = [
  "id", "jobId", "rank", "title", "start", "end", "durationSec", "score",
  "hook", "hookType", "genre", "reason", "transcript", "filePath", "publicUrl",
  "thumbnail", "caption", "starred", "createdAt",
];

export function readClips(): Clip[] {
  if (!existsSync(CLIPS_PATH)) return [];
  const content = readFileSync(CLIPS_PATH, "utf-8");
  if (!content.trim()) return [];
  const raw = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return raw.map((r) => ({
    id: r.id || "",
    jobId: r.jobId || "",
    rank: parseInt(r.rank || "0", 10) || 0,
    title: r.title || "",
    start: parseFloat(r.start || "0") || 0,
    end: parseFloat(r.end || "0") || 0,
    durationSec: parseFloat(r.durationSec || "0") || 0,
    score: parseInt(r.score || "0", 10) || 0,
    hook: r.hook || "",
    hookType: r.hookType || "",
    genre: r.genre || "",
    reason: r.reason || "",
    transcript: r.transcript || "",
    filePath: r.filePath || "",
    publicUrl: r.publicUrl || "",
    thumbnail: r.thumbnail || "",
    caption: r.caption || "",
    starred: r.starred === "true",
    createdAt: r.createdAt || "",
  }));
}

export function writeClips(clips: Clip[]): void {
  ensureDataDir();
  const output = stringify(clips as unknown as Record<string, unknown>[], {
    header: true,
    columns: CLIP_COLUMNS,
  });
  writeFileAtomic(CLIPS_PATH, output);
}

export function appendClips(newClips: Clip[]): void {
  if (newClips.length === 0) return;
  writeClips([...readClips(), ...newClips]);
}

export function clipsForJob(jobId: string): Clip[] {
  return readClips()
    .filter((c) => c.jobId === jobId)
    .sort((a, b) => b.score - a.score);
}

export function getClip(clipId: string): Clip | undefined {
  return readClips().find((c) => c.id === clipId);
}

export function updateClip(clipId: string, patch: Partial<Clip>): Clip | undefined {
  const clips = readClips();
  const idx = clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return undefined;
  clips[idx] = { ...clips[idx], ...patch };
  writeClips(clips);
  return clips[idx];
}

// ── Social accounts (JSON) ────────────────────────────────────────────────────────

export function readAccounts(): SocialAccount[] {
  if (!existsSync(ACCOUNTS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(ACCOUNTS_PATH, "utf-8")) as SocialAccount[];
  } catch {
    return [];
  }
}

export function writeAccounts(accounts: SocialAccount[]): void {
  ensureDataDir();
  writeFileAtomic(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

export function upsertAccount(account: SocialAccount): void {
  const accounts = readAccounts();
  const idx = accounts.findIndex(
    (a) =>
      (account.igUserId && a.igUserId === account.igUserId) || a.id === account.id
  );
  if (idx >= 0) {
    // Preserve the original id/connectedAt; refresh token + profile fields.
    accounts[idx] = { ...accounts[idx], ...account, id: accounts[idx].id, connectedAt: accounts[idx].connectedAt };
  } else {
    accounts.push(account);
  }
  writeAccounts(accounts);
}

/** Strip the access token before sending accounts to the client. */
export function publicAccounts(): Omit<SocialAccount, "accessToken">[] {
  return readAccounts().map(({ accessToken: _omit, ...rest }) => rest);
}

// ── Scheduled posts (JSON) ────────────────────────────────────────────────────────

export function readPosts(): ScheduledPost[] {
  if (!existsSync(POSTS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(POSTS_PATH, "utf-8")) as ScheduledPost[];
  } catch {
    return [];
  }
}

export function writePosts(posts: ScheduledPost[]): void {
  ensureDataDir();
  writeFileAtomic(POSTS_PATH, JSON.stringify(posts, null, 2));
}

export function upsertPost(post: ScheduledPost): void {
  const posts = readPosts();
  const idx = posts.findIndex((p) => p.id === post.id);
  if (idx >= 0) posts[idx] = post;
  else posts.push(post);
  writePosts(posts);
}

// ── Per-job transcript (word timings) — needed by the editor ───────────────────────

export function writeTranscript(jobId: string, words: Word[]): void {
  if (!existsSync(TRANSCRIPTS_DIR)) mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  writeFileAtomic(path.join(TRANSCRIPTS_DIR, `${jobId}.json`), JSON.stringify(words));
}

export function readTranscript(jobId: string): Word[] {
  const p = path.join(TRANSCRIPTS_DIR, `${jobId}.json`);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Word[];
  } catch {
    return [];
  }
}

// ── Clip edits (Phase 2) ───────────────────────────────────────────────────────────

export function readEdit(clipId: string): ClipEdit | undefined {
  const p = path.join(EDITS_DIR, `${clipId}.json`);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as ClipEdit;
  } catch {
    return undefined;
  }
}

export function writeEdit(clipId: string, edit: ClipEdit): void {
  if (!existsSync(EDITS_DIR)) mkdirSync(EDITS_DIR, { recursive: true });
  writeFileAtomic(path.join(EDITS_DIR, `${clipId}.json`), JSON.stringify(edit, null, 2));
}

/** Seed a default ClipEdit from an existing Clip + its Job. */
export function getDefaultEdit(clip: Clip, job: ClipJob): ClipEdit {
  const duration = Math.max(1, clip.end - clip.start);
  const caption = presetToCaptionConfig(job.captionPreset || "Karaoke");
  const textOverlays = job.autoHook && clip.hook
    ? [
        {
          id: "hook",
          text: clip.hook,
          start: 0,
          end: Math.min(5, duration),
          x: 0.5,
          y: 0.12,
          style: { bg: "#000000", color: "#FFFFFF", sizePx: 40, bold: true, radiusPx: 8 },
        },
      ]
    : [];
  return {
    clipId: clip.id,
    jobId: clip.jobId,
    aspectRatio: job.aspectRatio || "9:16",
    durationSec: duration,
    sourceInSec: clip.start,
    sourceOutSec: clip.end,
    layout: [{ id: "seg-0", start: 0, end: duration, mode: "fill" }],
    tracker: false,
    caption,
    removed: [],
    wordStyles: [],
    textOverlays,
    mediaOverlays: [],
    broll: [],
    transitions: [],
    autoTransitions: false,
    audio: [],
    updatedAt: new Date().toISOString(),
  };
}

// ── Caption templates ("My templates") ─────────────────────────────────────────────

export function readCaptionTemplates(): CaptionTemplate[] {
  if (!existsSync(CAPTION_TEMPLATES_PATH)) return [];
  try {
    return JSON.parse(readFileSync(CAPTION_TEMPLATES_PATH, "utf-8")) as CaptionTemplate[];
  } catch {
    return [];
  }
}

export function writeCaptionTemplates(templates: CaptionTemplate[]): void {
  ensureDataDir();
  writeFileAtomic(CAPTION_TEMPLATES_PATH, JSON.stringify(templates, null, 2));
}

// ── Caption prompt templates (reusable per-creator caption context) ─────────────────
// Distinct from the visual CaptionTemplate above: these hold the reusable text context
// (creator bio, niche, audience, CTA, hashtags, brand voice) that the caption generator
// uses as the fixed base for every clip from that creator. Persisted independent of any
// project/job so they are reusable across creators and clips.

export function readCaptionPromptTemplates(): CaptionPromptTemplate[] {
  if (!existsSync(CAPTION_PROMPT_TEMPLATES_PATH)) return [];
  try {
    return JSON.parse(readFileSync(CAPTION_PROMPT_TEMPLATES_PATH, "utf-8")) as CaptionPromptTemplate[];
  } catch {
    return [];
  }
}

export function writeCaptionPromptTemplates(templates: CaptionPromptTemplate[]): void {
  ensureDataDir();
  writeFileAtomic(CAPTION_PROMPT_TEMPLATES_PATH, JSON.stringify(templates, null, 2));
}

export function getCaptionPromptTemplate(id: string): CaptionPromptTemplate | undefined {
  return readCaptionPromptTemplates().find((t) => t.id === id);
}

export function upsertCaptionPromptTemplate(template: CaptionPromptTemplate): void {
  const templates = readCaptionPromptTemplates();
  const idx = templates.findIndex((t) => t.id === template.id);
  if (idx >= 0) templates[idx] = template;
  else templates.unshift(template);
  writeCaptionPromptTemplates(templates);
}

export function deleteCaptionPromptTemplate(id: string): void {
  writeCaptionPromptTemplates(readCaptionPromptTemplates().filter((t) => t.id !== id));
}
