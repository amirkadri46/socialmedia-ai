import { v4 as uuid } from "uuid";
import { copyFileSync, existsSync, statSync } from "fs";
import { downloadVideo, saveUpload } from "./download";
import { transcribe, wordsToText } from "./transcribe";
import { selectMoments, clipLengthRange } from "./moments";
import { renderClip } from "./render";
import { persistentSourcePath } from "./store";
import { usingSupabaseStorage, uploadClipFile } from "./storage";
import { repos } from "../db";
import type { ClipJob, ClipProgress, Clip, Moment, Word } from "../types";

// Render one clip at a time by default: two concurrent libx264 encodes plus the
// Next.js server can exceed the memory of a small container (e.g. Railway), which
// gets ffmpeg SIGKILLed mid-encode (surfaces as "ffmpeg exited null"). Bump this
// via CLIP_RENDER_CONCURRENCY on a host with more RAM.
const RENDER_CONCURRENCY = Math.max(1, parseInt(process.env.CLIP_RENDER_CONCURRENCY || "1", 10) || 1);

/**
 * Human-readable message from any throwable. Supabase repos throw PostgrestError *objects*
 * (not Error instances), so `err instanceof Error` alone reduces real DB/storage failures to
 * a useless "Unknown error" — this digs out the actual message.
 */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    // Don't serialize the whole object into a user-facing message — it can leak
    // internal/connection details. Log the raw error for server-side debugging instead.
    console.error("[clip-pipeline] Non-Error thrown:", err);
    return "Unexpected error";
  }
  if (typeof err === "string" && err) return err;
  return "Unknown error";
}

/** Thrown internally when a job is canceled so the pipeline unwinds cleanly. */
class CanceledError extends Error {
  constructor() {
    super("Job canceled by user.");
    this.name = "CanceledError";
  }
}

// Map the UI language label to a Deepgram/AssemblyAI language code.
const LANGUAGE_CODES: Record<string, string> = {
  english: "en",
  spanish: "es",
  french: "fr",
  german: "de",
  portuguese: "pt",
  hindi: "hi",
  hinglish: "hi-Latn",
};

function languageCode(label: string): string {
  return LANGUAGE_CODES[(label || "English").toLowerCase()] || "en";
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface RunInput {
  job: ClipJob;
  /** Provided when the source is an uploaded file rather than a URL. */
  uploadBuffer?: Buffer;
  uploadExt?: string;
}

/**
 * Full clip pipeline: download/ingest → transcribe → select moments → render each.
 * Emits ClipProgress through onProgress (consumed by the SSE route) and persists the
 * ClipJob + produced Clips so the results survive a page reload (PRD §3, §5).
 */
export async function runClipPipeline(
  { job, uploadBuffer, uploadExt }: RunInput,
  onProgress: (p: ClipProgress) => void
): Promise<void> {
  const progress: ClipProgress = {
    jobId: job.id,
    status: "downloading",
    sourceTitle: job.sourceTitle,
    curationMethod: job.clipModel,
    percent: 0,
    momentsTotal: 0,
    clipsRendered: 0,
    log: [],
    errors: [],
  };

  const emit = () => {
    const snapshot = { ...progress, log: [...progress.log], errors: [...progress.errors] };
    // Persist live progress so a client that navigated away can re-attach and keep
    // watching — the pipeline runs detached from any single HTTP request.
    repos.clipJobs.setProgress(job.id, snapshot).catch((err) => {
      console.error("[clip-pipeline] Failed to persist progress for job", job.id, err);
    });
    onProgress(snapshot);
  };
  const log = (msg: string) => {
    progress.log.push(`${msg}`);
    emit();
  };
  const setStatus = async (s: ClipJob["status"], percent: number) => {
    progress.status = s;
    progress.percent = percent;
    job.status = s;
    await repos.clipJobs.upsert(job);
    emit();
  };
  // Cancellation is the only thing that stops a running job. Checked between steps.
  const checkCancel = () => {
    if (repos.clipJobs.isCancelRequested(job.id)) throw new CanceledError();
  };

  try {
    await repos.clipJobs.upsert(job);
    const { min, max } = clipLengthRange(job.clipLengthMode);

    // 1. Ingest ──────────────────────────────────────────────────────────────────
    checkCancel();
    await setStatus("downloading", 5);
    log(`Fetching video "${job.sourceTitle}"`);
    log(`Curation method: ${job.clipModel}...`);

    let sourcePath: string;
    if (uploadBuffer) {
      const res = await saveUpload(uploadBuffer, job.id, uploadExt || "mp4");
      sourcePath = res.path;
      if (res.meta.durationSec) job.sourceDurationSec = res.meta.durationSec;
    } else if (job.sourceUrl) {
      const { ytDlpCookiesBrowser, ytDlpCookiesText } = await repos.settings.get();
      const res = await downloadVideo(job.sourceUrl, job.id, (line) => {
        // line looks like "Downloading 45.2%" — keep the decimal so percent is accurate.
        const pct = parseFloat(line.match(/([\d.]+)/)?.[1] ?? "0") || 0;
        progress.percent = Math.min(20, 5 + Math.round(pct * 0.15));
        emit();
      }, ytDlpCookiesBrowser || undefined, ytDlpCookiesText || undefined);
      sourcePath = res.path;
      if (res.meta.durationSec) job.sourceDurationSec = res.meta.durationSec;
    } else {
      throw new Error("Job has neither a source URL nor an uploaded file.");
    }

    // Copy source to the persistent data/clips/ dir so the editor still works
    // after the OS clears the temp directory or the server restarts.
    const pSrc = persistentSourcePath(job.id);
    if (!existsSync(pSrc)) {
      try { copyFileSync(sourcePath, pSrc); } catch { /* non-fatal — temp path still usable for this session */ }
    }
    // In supabase mode the editor's source video is served from the clip-sources bucket.
    // Skip the upload for large sources: it would read the whole (multi-GB) file into
    // memory and fail anyway on Supabase's per-file limit — wasting time + memory on the
    // hot path. The clips (the product) are uploaded per-clip below regardless; only the
    // editor's full-source scrubbing is unavailable for very long videos.
    if (usingSupabaseStorage()) {
      const maxMb = parseInt(process.env.CLIP_SOURCE_UPLOAD_MAX_MB || "100", 10) || 100;
      const sizeMb = statSync(sourcePath).size / (1024 * 1024);
      if (sizeMb > maxMb) {
        log(`Source too large for editor playback (${Math.round(sizeMb)} MB > ${maxMb} MB) — skipped; clips still render.`);
      } else {
        try {
          await uploadClipFile("clip-sources", `${job.id}.mp4`, sourcePath, "video/mp4");
        } catch (err) {
          log(`Warning: could not upload source for the editor: ${errMessage(err)}`);
        }
      }
    }

    const rangeEnd = job.rangeEndSec > 0 ? job.rangeEndSec : job.sourceDurationSec;
    progress.rangeLabel = `From ${fmtClock(job.rangeStartSec)} to ${fmtClock(rangeEnd)}, preferred clip length of ${min}-${max}s...`;
    progress.etaSeconds = Math.max(60, Math.round((rangeEnd - job.rangeStartSec) * 0.4));
    log(progress.rangeLabel);
    log(`Estimated waiting time: ~${Math.ceil((progress.etaSeconds || 60) / 60)}min`);

    // 2. Transcribe ────────────────────────────────────────────────────────────────
    checkCancel();
    await setStatus("transcribing", 25);
    log("Transcribing audio...");
    const langCode = languageCode(job.speechLanguage);
    // Transcription is one long await with no sub-progress, so the bar sits at 25% and
    // looks frozen. Emit a heartbeat every 15s so the user sees it's still working.
    const tStart = Date.now();
    const heartbeat = setInterval(() => {
      log(`Transcribing audio… still working (${Math.round((Date.now() - tStart) / 1000)}s)`);
    }, 15_000);
    let words: Word[];
    try {
      words = await transcribe(sourcePath, langCode);
    } finally {
      clearInterval(heartbeat);
    }
    await repos.clipTranscripts.write(job.id, words); // persist for the clip editor (Phase 2)
    log(`Transcribed ${words.length} words.`);

    // 3. Select moments ──────────────────────────────────────────────────────────────
    checkCancel();
    await setStatus("selecting", 40);
    log("Processing & analyzing... finding the most viral moments");
    const moments: Moment[] = await selectMoments(words, job);
    progress.momentsTotal = moments.length;
    log(`Selected ${moments.length} moments to render.`);
    emit();

    // 4. Render each moment ──────────────────────────────────────────────────────────
    await setStatus("rendering", 50);
    const produced: Clip[] = [];

    await runWithConcurrency(moments, RENDER_CONCURRENCY, async (moment, i) => {
      try {
        checkCancel();
        const clipId = uuid();
        const { filePath, thumbnail } = await renderClip(
          sourcePath,
          words,
          moment,
          job,
          clipId,
          () => {}
        );
        // In supabase mode the rendered files live on ephemeral local disk; upload them
        // and store the bucket object keys so the media/thumb/download routes resolve.
        let storedFile = filePath;
        let storedThumb = thumbnail;
        if (usingSupabaseStorage()) {
          storedFile = await uploadClipFile("clips", `${clipId}.mp4`, filePath, "video/mp4");
          if (thumbnail) storedThumb = await uploadClipFile("clip-thumbnails", `${clipId}.jpg`, thumbnail, "image/jpeg");
        }
        const clip: Clip = {
          id: clipId,
          jobId: job.id,
          rank: i + 1,
          title: moment.title,
          start: moment.start,
          end: moment.end,
          durationSec: Number((moment.end - moment.start).toFixed(2)),
          score: moment.score,
          hook: moment.hook,
          hookType: moment.hookType,
          genre: moment.genre,
          reason: moment.reason,
          transcript: wordsToText(words, moment.start, moment.end),
          filePath: storedFile,
          thumbnail: storedThumb,
          caption: "",
          starred: false,
          createdAt: new Date().toISOString(),
        };
        produced.push(clip);
        progress.clipsRendered = produced.length;
        progress.percent = 50 + Math.round((produced.length / moments.length) * 50);
        log(`Rendered clip ${produced.length}/${moments.length}: ${moment.title} (${moment.score})`);
      } catch (err) {
        if (err instanceof CanceledError) throw err; // propagate; don't swallow as a render error
        // errMessage handles non-Error throwables (e.g. Supabase upload errors) so this never
        // records "[object Object]" in progress.errors.
        const msg = `Render error for "${moment.title}": ${errMessage(err)}`;
        progress.errors.push(msg);
        log(msg);
      }
    });

    // The per-clip render failures are already collected in progress.errors and get
    // persisted to job.errors by the catch below, so the results page shows the real
    // cause (ffmpeg stderr, missing fonts, etc.) — not just this summary line.
    if (produced.length === 0) throw new Error("No clips were rendered successfully.");

    // Persist clips sorted by score (highest rank = 1).
    produced.sort((a, b) => b.score - a.score);
    produced.forEach((c, idx) => (c.rank = idx + 1));
    await repos.clips.append(produced);

    job.errors = progress.errors;
    await setStatus("done", 100);
    log(`Done — ${produced.length} clips ready.`);
  } catch (err) {
    if (err instanceof CanceledError) {
      await setStatus("canceled", progress.percent);
      log("Canceled by user.");
    } else {
      const msg = errMessage(err);
      progress.errors.push(msg);
      job.errors = [...new Set([...(job.errors || []), ...progress.errors])];
      await setStatus("error", progress.percent);
      log(`Error: ${msg}`);
    }
  } finally {
    // Job has reached a terminal state — release the cancel flag and drop the live
    // progress snapshot after a short grace period so reconnecting clients can read
    // the final state once before it's cleared.
    repos.clipJobs.clearCancel(job.id);
    setTimeout(() => repos.clipJobs.clearProgress(job.id).catch((err) => {
      console.error("[clip-pipeline] Failed to clear progress for job", job.id, err);
    }), 30_000);
  }
}
