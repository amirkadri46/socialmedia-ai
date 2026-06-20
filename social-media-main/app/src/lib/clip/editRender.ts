import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import { ffmpeg } from "./ffmpeg";
import { aspectDims } from "./render";
import { buildAssFromConfig } from "./captions";
import { clipMediaDir, updateClip } from "./store";
import { keptSegments, editedDuration, windowToEdited } from "./edit-timeline";
import type { ClipEdit, Word, TextOverlay } from "../types";

function sourcePath(jobId: string): string {
  return path.join(os.tmpdir(), "social-clipper", jobId, "source.mp4");
}

function fmtAssTime(t: number): string {
  if (t < 0) t = 0;
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Build an .ass for the draggable text overlays (hook chips/titles), in edited time. */
function buildOverlayAss(overlays: TextOverlay[], dir: string, w: number, h: number): string {
  if (!overlays.length) return "";
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Ov,Arial,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,2,0,5,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text`;
  const lines = overlays.map((o) => {
    const size = Math.round((o.style.sizePx * h) / 1920);
    const text = o.text.replace(/\n/g, " ").replace(/[{}]/g, "");
    return `Dialogue: 1,${fmtAssTime(o.start)},${fmtAssTime(o.end)},Ov,,0,0,0,,{\\pos(${Math.round(o.x * w)},${Math.round(o.y * h)})\\fs${size}}${text}`;
  });
  const p = path.join(dir, "overlays.ass");
  writeFileSync(p, `${header}\n${lines.join("\n")}\n`, "utf-8");
  return p;
}

/** Words mapped into the edited timeline (removed gaps closed), rebased to 0. */
function editedWords(edit: ClipEdit, words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words) {
    if (w.end <= edit.sourceInSec || w.start >= edit.sourceOutSec) continue;
    const ws = w.start - edit.sourceInSec;
    const we = w.end - edit.sourceInSec;
    if (edit.removed.some((r) => ws < r.end && we > r.start)) continue; // dropped by cleanup
    out.push({ text: w.text, start: windowToEdited(edit, ws), end: windowToEdited(edit, we) });
  }
  return out;
}

export interface ExportProgress {
  percent: number;
  log: string;
  done?: string; // download URL when finished
}

/**
 * Compile a ClipEdit into a final mp4 that reproduces the preview:
 *   pass 1 — speech cuts + reframe (Fill/Fit) + audio concat → spine
 *   pass 2 — burn captions + text overlays + mix uploaded audio → final
 * (Media/B-roll/transition compositing in export is a later increment.)
 */
export async function exportEdit(
  edit: ClipEdit,
  words: Word[],
  onProgress: (p: ExportProgress) => void
): Promise<string> {
  const src = sourcePath(edit.jobId);
  if (!existsSync(src)) {
    throw new Error("Source video is no longer available — re-run the clip to edit/export it.");
  }
  const { w, h } = aspectDims(edit.aspectRatio);
  const work = path.join(os.tmpdir(), "social-clipper", edit.jobId, `export-${edit.clipId}`);
  if (!existsSync(work)) mkdirSync(work, { recursive: true });

  const seg0 = edit.layout[0];
  const mode = seg0?.mode ?? "fill";
  const crop = seg0?.crop;
  let reframe: string;
  if (mode === "fit") {
    reframe = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(${w}-iw)/2:(${h}-ih)/2:black`;
  } else if (crop && crop.w > 0 && crop.h > 0) {
    // Manual crop: take the chosen source rect, then scale to the target (aspect-locked
    // in the UI, so no distortion). Matches the preview's crop→canvas mapping.
    const cw = crop.w.toFixed(5), ch = crop.h.toFixed(5), cx = crop.x.toFixed(5), cy = crop.y.toFixed(5);
    reframe = `crop=iw*${cw}:ih*${ch}:iw*${cx}:ih*${cy},scale=${w}:${h}`;
  } else {
    reframe = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }

  // ── Pass 1: cuts + reframe → spine.mp4 ──────────────────────────────────────────
  onProgress({ percent: 10, log: "Cutting & reframing…" });
  const segs = keptSegments(edit);
  if (segs.length === 0) {
    throw new Error("Everything is removed — keep at least some footage before exporting.");
  }
  const parts: string[] = [];
  const labels: string[] = [];
  segs.forEach((s, i) => {
    const start = (edit.sourceInSec + s.start).toFixed(3);
    const end = (edit.sourceInSec + s.end).toFixed(3);
    parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${reframe},setsar=1[v${i}]`);
    parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const concat = `${labels.join("")}concat=n=${segs.length}:v=1:a=1[vc][ac]`;
  const filter1 = [...parts, concat].join(";");
  const spine = path.join(work, "spine.mp4");
  await ffmpeg(
    [
      "-y", "-i", src,
      "-filter_complex", filter1,
      "-map", "[vc]", "-map", "[ac]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      spine,
    ],
    { cwd: work }
  );

  // ── Pass 2: captions + text overlays + audio mix → final ────────────────────────
  onProgress({ percent: 55, log: "Burning captions & mixing audio…" });
  const captionAss = buildAssFromConfig(editedWords(edit, words), edit.caption, work, w, h, edit.clipId);
  const overlayAss = buildOverlayAss(edit.textOverlays, work, w, h);

  const vfilters: string[] = [];
  if (captionAss) vfilters.push(`ass=${path.basename(captionAss)}`);
  if (overlayAss) vfilters.push(`ass=${path.basename(overlayAss)}`);

  const args: string[] = ["-y", "-i", spine];
  const extraAudio = edit.audio.filter((a) => a.src);
  extraAudio.forEach((a) => args.push("-i", a.src));

  const aFilters: string[] = [];
  if (extraAudio.length) {
    aFilters.push(`[0:a]volume=1.0[a0]`);
    extraAudio.forEach((a, i) => {
      const inIdx = i + 1;
      const delay = Math.max(0, a.start) * 1000;
      let chain = `[${inIdx}:a]volume=${a.gain.toFixed(2)}`;
      if (a.fadeInSec) chain += `,afade=t=in:st=0:d=${a.fadeInSec}`;
      if (a.fadeOutSec) chain += `,afade=t=out:st=${Math.max(0, a.end - a.start - a.fadeOutSec)}:d=${a.fadeOutSec}`;
      chain += `,adelay=${delay}|${delay}[am${i}]`;
      aFilters.push(chain);
    });
    const mixIns = ["[a0]", ...extraAudio.map((_, i) => `[am${i}]`)].join("");
    aFilters.push(`${mixIns}amix=inputs=${extraAudio.length + 1}:duration=first:normalize=0[aout]`);
  }

  const filter2parts: string[] = [];
  if (vfilters.length) filter2parts.push(`[0:v]${vfilters.join(",")}[vout]`);
  if (aFilters.length) filter2parts.push(...aFilters);

  const final = path.join(clipMediaDir(), `${edit.clipId}-edited.mp4`);
  const args2 = [...args];
  if (filter2parts.length) {
    args2.push("-filter_complex", filter2parts.join(";"));
    args2.push("-map", vfilters.length ? "[vout]" : "0:v");
    args2.push("-map", aFilters.length ? "[aout]" : "0:a");
  } else {
    args2.push("-map", "0:v", "-map", "0:a");
  }
  args2.push(
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    final
  );

  const totalDur = editedDuration(edit);
  await ffmpeg(args2, {
    cwd: work,
    onStderr: (chunk) => {
      const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && totalDur > 0) {
        const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
        onProgress({ percent: 55 + Math.min(44, Math.round((t / totalDur) * 44)), log: "Rendering…" });
      }
    },
  });

  // Point the Clip at the edited file so results/download/schedule use it (keep original too).
  updateClip(edit.clipId, { filePath: final });
  onProgress({ percent: 100, log: "Done", done: `/api/clip/download/${edit.clipId}` });
  return final;
}
