import { chat, extractJson } from "./llm";
import type { Word, Moment, ClipJob } from "../types";

/** Map a clip-length mode label to a [min,max] target duration in seconds. */
export function clipLengthRange(mode: string): { min: number; max: number } {
  const m = mode.toLowerCase();
  if (m.includes("<30") || m.includes("under 30")) return { min: 8, max: 30 };
  if (m.includes("30") && m.includes("60")) return { min: 30, max: 60 };
  if (m.includes("60") && m.includes("90")) return { min: 60, max: 90 };
  return { min: 15, max: 180 }; // Auto (0-3m)
}

/** Build a compact, timestamped transcript the LLM can reason over. */
function buildTimedTranscript(words: Word[], start: number, end: number): string {
  const lines: string[] = [];
  let bucket: Word[] = [];
  let bucketStart = -1;
  const flush = () => {
    if (!bucket.length) return;
    const text = bucket.map((w) => w.text).join(" ");
    lines.push(`[${bucketStart.toFixed(1)}] ${text}`);
    bucket = [];
  };
  for (const w of words) {
    if (w.start < start || w.start >= end) continue;
    if (bucketStart < 0) bucketStart = w.start;
    bucket.push(w);
    // flush roughly every ~12s of speech to keep timestamp granularity
    if (w.end - bucketStart >= 12) {
      flush();
      bucketStart = -1;
    }
  }
  flush();
  return lines.join("\n");
}

interface RawMoment {
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
  genre: string;
  hookType: string;
}

/**
 * Ask the LLM to pick the most viral moments within the job's timeframe.
 * Honors genre, clip-length mode, includeMomentsPrompt and topK.
 */
export async function selectMoments(words: Word[], job: ClipJob): Promise<Moment[]> {
  const start = job.rangeStartSec;
  const end = job.rangeEndSec > 0 ? job.rangeEndSec : job.sourceDurationSec;
  const { min, max } = clipLengthRange(job.clipLengthMode);
  const transcript = buildTimedTranscript(words, start, end);

  if (!transcript.trim()) {
    throw new Error("Transcript is empty for the selected timeframe — nothing to clip.");
  }

  const genreLine =
    job.genre && job.genre.toLowerCase() !== "auto"
      ? `Bias selections toward the "${job.genre}" genre.`
      : "Infer the best genre for each moment.";
  const includeLine = job.includeMomentsPrompt?.trim()
    ? `The user specifically wants moments about: ${job.includeMomentsPrompt.trim()}`
    : "";

  const prompt = `# ROLE
You are an expert short-form video editor who finds the most viral, self-contained moments in a long video — the engine behind tools like OpusClip.

# SOURCE TRANSCRIPT (timestamps in seconds, "[t] text")
${transcript}

# TASK
Select the ${job.topK} BEST moments to cut into vertical short clips.
Rules:
- Each moment must be self-contained: a complete thought, story, or insight a viewer could understand with no other context.
- Target duration between ${min} and ${max} seconds. "start" and "end" are seconds in the source.
- Stay within the timeframe ${start.toFixed(0)}s–${end.toFixed(0)}s.
- Prefer strong hooks, emotional peaks, contrarian takes, surprising facts, and clear payoffs.
- ${genreLine}
${includeLine ? `- ${includeLine}\n` : ""}- Rank by virality: "score" is 0–100, higher = more likely to go viral. No two moments should overlap.

# OUTPUT
Return ONLY a JSON array (no prose) of exactly the top moments, each:
{
  "start": number,        // seconds
  "end": number,          // seconds
  "title": string,        // punchy clip title
  "hook": string,         // <=60 char on-screen text hook for the first 5s
  "score": number,        // 0-100 virality
  "reason": string,       // one sentence: why this will perform
  "genre": string,        // e.g. "Journey & tutorial", "Hot take", "Story"
  "hookType": string      // e.g. "Intrigue hook", "Question hook", "Bold claim"
}`;

  // Keep the chat() call outside the retry path: a transport/auth failure (401/429/timeout)
  // should propagate, not trigger a second billed call. Only a JSON parse failure is retried.
  const raw = await chat(prompt, 4096);
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch {
    // Some models (esp. reasoning models) occasionally return empty/garbled output on the
    // first try. Retry once with a stricter instruction before giving up.
    parsed = extractJson(
      await chat(`${prompt}\n\nReturn ONLY the raw JSON array — no prose, no code fences, no explanation.`, 4096)
    );
  }
  if (!Array.isArray(parsed)) throw new Error("LLM did not return a JSON array of moments.");

  const moments: Moment[] = (parsed as RawMoment[])
    .map((m) => ({
      start: Math.max(start, Number(m.start) || 0),
      end: Math.min(end, Number(m.end) || 0),
      title: String(m.title || "Untitled clip").slice(0, 120),
      hook: String(m.hook || "").slice(0, 80),
      score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))),
      reason: String(m.reason || ""),
      genre: String(m.genre || "Story"),
      hookType: String(m.hookType || "Intrigue hook"),
    }))
    .filter((m) => m.end - m.start >= Math.min(5, min) && m.end > m.start)
    .sort((a, b) => b.score - a.score)
    .slice(0, job.topK);

  if (moments.length === 0) {
    throw new Error("No valid moments were selected. Try a different timeframe or clip length.");
  }
  return moments;
}
