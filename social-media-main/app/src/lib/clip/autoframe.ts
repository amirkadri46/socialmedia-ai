import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import { ffmpeg, probe } from "./ffmpeg";
import { buildCropRect, buildCropRectForAspect } from "./face-crop";
import { paneCount, slotAspect, splitSlots } from "./layout-geom";
import { persistentSourcePath, clipsForJob } from "./store";
import type { LayoutKind, LayoutSegment, SpeakerPane } from "../types";

// ── Auto Fill/Fit reframe (3C) ──────────────────────────────────────────────────────
// Sample frames across the clip window, classify each as "speaker present" (→ Fill, with
// a face-centered crop) vs "no speaker" (b-roll / text / wide graphic → Fit), then merge
// contiguous same-mode runs into LayoutSegments (CLIP-LOCAL/window seconds, from 0).
//
// AI model (Aamir asked "best AI model to analyse fast"):
//   • Default — Gemini 2.0/2.5 Flash on ONE contact-sheet image (all frames tiled into a
//     single multimodal request → one API call for the whole clip = fast + cheap). The repo
//     already uses Gemini, so credentials/patterns exist.
//   • Fallback — GPT-4o vision per frame (slower/pricier), used when GEMINI_API_KEY is absent.
// The detector is swappable behind `classifyFrames`.

export interface FrameClass {
  speaker: boolean; // is a person the main subject of this frame?
  cx: number; // face center X, normalized 0–1 within the frame
  cy: number; // face center Y, normalized 0–1
}

const MIN_RUN_SEC = 0.5; // drop sub-0.5s flickers
const MAX_FRAMES = 48; // cap sampled frames (keeps the contact sheet + cost bounded)

/** Resolve the source video for a job — persistent copy first, then tmpdir, then first clip file. */
function sourcePath(jobId: string): string {
  const persistent = persistentSourcePath(jobId);
  if (existsSync(persistent)) return persistent;
  const temp = path.join(os.tmpdir(), "social-clipper", jobId, "source.mp4");
  if (existsSync(temp)) return temp;
  for (const c of clipsForJob(jobId)) {
    if (c.filePath && existsSync(c.filePath)) return c.filePath;
  }
  return temp; // callers check existsSync and throw a user-friendly error
}

/**
 * Detect Fill/Fit segments for the clip window [sourceInSec, sourceOutSec].
 * Returns LayoutSegments in CLIP-LOCAL seconds (start/end from 0); the route maps them
 * into edited-timeline coords before persisting.
 */
export async function autoFrameSegments(
  jobId: string,
  sourceInSec: number,
  sourceOutSec: number,
  aspect: string
): Promise<LayoutSegment[]> {
  const src = sourcePath(jobId);
  if (!existsSync(src)) {
    throw new Error("Source video is no longer available — re-run the clip to auto-reframe it.");
  }
  const duration = Math.max(1, sourceOutSec - sourceInSec);
  const { width: srcW, height: srcH } = await probe(src);

  // One frame per second, capped. interval = window length / frameCount.
  const frameCount = Math.max(1, Math.min(MAX_FRAMES, Math.round(duration)));
  const interval = duration / frameCount;
  // Sample at the middle of each interval for a representative frame.
  const times = Array.from({ length: frameCount }, (_, k) => sourceInSec + (k + 0.5) * interval);

  const classes = await classifyFrames(src, times, sourceInSec, duration);

  // Per-frame → mode + crop.
  const frames = classes.map((c) => ({
    mode: c.speaker ? ("fill" as const) : ("fit" as const),
    cx: c.cx,
    cy: c.cy,
  }));

  // Merge contiguous same-mode runs (averaging face center across a Fill run).
  type Run = { mode: "fill" | "fit"; from: number; to: number; cxs: number[]; cys: number[] };
  const runs: Run[] = [];
  frames.forEach((f, i) => {
    const last = runs[runs.length - 1];
    if (last && last.mode === f.mode) {
      last.to = i + 1;
      last.cxs.push(f.cx);
      last.cys.push(f.cy);
    } else {
      runs.push({ mode: f.mode, from: i, to: i + 1, cxs: [f.cx], cys: [f.cy] });
    }
  });

  // Drop sub-MIN_RUN_SEC flickers by folding them into the previous run.
  const merged: Run[] = [];
  for (const r of runs) {
    const lenSec = (r.to - r.from) * interval;
    const prev = merged[merged.length - 1];
    if (prev && lenSec < MIN_RUN_SEC) {
      prev.to = r.to;
      prev.cxs.push(...r.cxs);
      prev.cys.push(...r.cys);
    } else {
      merged.push({ ...r, cxs: [...r.cxs], cys: [...r.cys] });
    }
  }

  let prevEnd = 0;
  return merged.map((r, i) => {
    // Chain each segment off the previous one's end so the layout is always gap/overlap-free
    // (float drift in r.from*interval could otherwise leave holes); last segment runs to the end.
    const start = prevEnd;
    const end = i === merged.length - 1 ? duration : r.to * interval;
    prevEnd = end;
    const seg: LayoutSegment = {
      id: crypto.randomUUID(),
      start,
      end,
      mode: r.mode,
    };
    if (r.mode === "fill") {
      const cx = r.cxs.reduce((s, v) => s + v, 0) / r.cxs.length;
      const cy = r.cys.reduce((s, v) => s + v, 0) / r.cys.length;
      seg.crop = buildCropRect(cx, cy, srcW, srcH, aspect);
    }
    return seg;
  });
}

// ── Multiple-speaker layouts (3D) ────────────────────────────────────────────────────
// Detect up to N distinct speaker faces in a segment window and build one face-crop per
// canvas slot (slot pixel-aspect, so each pane fully covers its slot). Used to seed
// SpeakerPane[] when the editor enables a split/triple/quad layout.

export async function detectSpeakerPanes(
  jobId: string,
  sourceInSec: number,
  sourceOutSec: number,
  kind: LayoutKind,
  canvasAR: number
): Promise<SpeakerPane[]> {
  const n = paneCount(kind);
  const slots = splitSlots(kind);
  const src = sourcePath(jobId);
  if (!existsSync(src)) {
    throw new Error("Source video is no longer available — re-run the clip to enable layouts.");
  }
  const { width: srcW, height: srcH } = await probe(src);
  const mid = sourceInSec + (sourceOutSec - sourceInSec) / 2;

  let faces: { cx: number; cy: number }[] = [];
  try {
    faces = await detectFaces(src, mid, n);
  } catch {
    faces = [];
  }
  // Sort detected faces top→bottom then left→right so they map to stacked/grid slots sensibly.
  faces.sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  return slots.map((slot, i) => {
    const f = faces[i] ?? { cx: 0.5, cy: 0.4 }; // fewer faces than slots → centered default
    const ar = slotAspect(slot, canvasAR);
    return { crop: buildCropRectForAspect(f.cx, f.cy, srcW, srcH, ar, 0.3) };
  });
}

/** Detect up to `maxN` distinct face centers in one frame (Gemini, GPT-4o fallback). */
async function detectFaces(src: string, atSec: number, maxN: number): Promise<{ cx: number; cy: number }[]> {
  const tmp = path.join(os.tmpdir(), `faces-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  const jpg = path.join(tmp, "f.jpg");
  try {
    await ffmpeg(["-y", "-ss", atSec.toFixed(3), "-i", src, "-frames:v", "1", "-vf", "scale=720:-1", "-q:v", "4", jpg]);
    if (!existsSync(jpg)) throw new Error("Frame extraction failed.");
    const b64 = readFileSync(jpg).toString("base64");
    const prompt =
      `Find up to ${maxN} distinct people's faces in this image (the on-screen speakers). ` +
      `Return ONLY a JSON array, one object per face, each {"cx":0.5,"cy":0.3} with the face center ` +
      `normalized 0–1 (cx=0 left → 1 right, cy=0 top → 1 bottom), ordered by horizontal position. ` +
      `Return [] if no clear faces.`;

    if (process.env.GEMINI_API_KEY) {
      const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: b64 } }, { text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return parseFaces(data.candidates?.[0]?.content?.parts?.[0]?.text ?? "", maxN);
      }
    }
    if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const res = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" } },
          ],
        }],
      });
      return parseFaces(res.choices[0]?.message?.content ?? "", maxN);
    }
    return [];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Parse a face-center list, clamped and capped at `maxN`. */
function parseFaces(text: string, maxN: number): { cx: number; cy: number }[] {
  let parsed: unknown;
  try {
    const m = text.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const norm = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  return parsed
    .slice(0, maxN)
    .map((o) => {
      const obj = (o ?? {}) as { cx?: number; cy?: number };
      return { cx: norm(obj.cx, 0.5), cy: norm(obj.cy, 0.4) };
    });
}

/** Classify each sampled frame as speaker/face — Gemini contact sheet, GPT-4o fallback. */
async function classifyFrames(
  src: string,
  times: number[],
  sourceInSec: number,
  duration: number
): Promise<FrameClass[]> {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await classifyContactSheet(src, sourceInSec, duration, times.length);
    } catch {
      // fall through to GPT-4o if the single-call path fails
    }
  }
  if (process.env.OPENAI_API_KEY) {
    return classifyFramesGpt(src, times);
  }
  // No vision key — assume speaker present (plain center crop) so Fill is the safe default.
  return times.map(() => ({ speaker: true, cx: 0.5, cy: 0.35 }));
}

// ── Default: Gemini 2.x Flash on a single tiled contact sheet (one API call) ──────────
async function classifyContactSheet(
  src: string,
  sourceInSec: number,
  duration: number,
  frameCount: number
): Promise<FrameClass[]> {
  const cols = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / cols);
  const effFps = frameCount / duration;

  const tmp = path.join(os.tmpdir(), `autoframe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  const sheet = path.join(tmp, "sheet.jpg");
  try {
    await ffmpeg([
      "-y",
      "-ss", sourceInSec.toFixed(3),
      "-i", src,
      "-t", duration.toFixed(3),
      "-vf", `fps=${effFps.toFixed(5)},scale=240:-1,tile=${cols}x${rows}`,
      "-frames:v", "1",
      "-q:v", "4",
      sheet,
    ]);
    if (!existsSync(sheet)) throw new Error("Contact sheet extraction failed.");
    const b64 = readFileSync(sheet).toString("base64");

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const prompt =
      `This image is a contact sheet of ${frameCount} video frames laid out in a ${cols}-column by ${rows}-row grid, ` +
      `read left-to-right, top-to-bottom, indexed 0 to ${frameCount - 1} (some bottom cells may be blank — mark those speaker:false). ` +
      `For EACH frame index, decide whether a person (a speaker/presenter) is the main subject visible, and give that person's face center ` +
      `within THAT frame's cell, normalized 0–1 (cx=0 left, 1 right; cy=0 top, 1 bottom). ` +
      `Return ONLY a JSON array of exactly ${frameCount} objects ordered by index: ` +
      `[{"i":0,"speaker":true,"cx":0.5,"cy":0.3}, ...]. If no clear person, use speaker:false,cx:0.5,cy:0.5.`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: b64 } }, { text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });
    if (!res.ok) throw new Error(`Gemini autoframe error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return parseClasses(text, frameCount);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Fallback: GPT-4o vision, one call per frame ──────────────────────────────────────
async function classifyFramesGpt(src: string, times: number[]): Promise<FrameClass[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const out: FrameClass[] = [];
  for (const t of times) {
    const tmp = path.join(os.tmpdir(), `af-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmp, { recursive: true });
    const jpg = path.join(tmp, "f.jpg");
    try {
      await ffmpeg(["-y", "-ss", t.toFixed(3), "-i", src, "-frames:v", "1", "-vf", "scale=480:-1", "-q:v", "5", jpg]);
      const b64 = readFileSync(jpg).toString("base64");
      const res = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 60,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: 'Is a person (speaker) the main subject of this frame? Return ONLY JSON: {"speaker":true,"cx":0.5,"cy":0.3} with the face center normalized 0–1. If no clear person: {"speaker":false,"cx":0.5,"cy":0.5}.' },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" } },
          ],
        }],
      });
      out.push(parseClasses(res.choices[0]?.message?.content ?? "", 1)[0]);
    } catch {
      out.push({ speaker: true, cx: 0.5, cy: 0.35 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return out;
}

/** Parse a model response (array or single object) into exactly `count` FrameClass entries. */
function parseClasses(text: string, count: number): FrameClass[] {
  const fallback: FrameClass = { speaker: true, cx: 0.5, cy: 0.35 };
  let parsed: unknown;
  try {
    const m = text.match(/\[[\s\S]*\]/) ?? text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : text);
  } catch {
    return Array.from({ length: count }, () => ({ ...fallback }));
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const norm = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  const byIndex = new Map<number, FrameClass>();
  arr.forEach((o, k) => {
    const obj = (o ?? {}) as { i?: number; speaker?: boolean; cx?: number; cy?: number };
    const idx = typeof obj.i === "number" ? obj.i : k;
    byIndex.set(idx, { speaker: obj.speaker !== false, cx: norm(obj.cx, 0.5), cy: norm(obj.cy, 0.35) });
  });
  return Array.from({ length: count }, (_, i) => byIndex.get(i) ?? { ...fallback });
}
