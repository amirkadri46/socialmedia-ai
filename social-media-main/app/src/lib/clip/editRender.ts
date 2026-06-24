import { existsSync, mkdirSync, writeFileSync, renameSync, statSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { ffmpeg, probe } from "./ffmpeg";
import { aspectDims } from "./render";
import { buildAssFromConfig } from "./captions";
import { clipMediaDir, updateClip } from "./store";
import { allTransitions, keptSegments, editedDuration, windowToEdited, layoutAt } from "./edit-timeline";
import { paneCount, resolveFrame, splitSlots } from "./layout-geom";
import type { ClipEdit, CropRect, Word, TextOverlay, LayoutSegment, TransitionMarker, BlurBackground } from "../types";

/** ClipEdit transition type → ffmpeg `xfade` transition name (parity with the preview). */
const xfadeMap: Record<TransitionMarker["type"], string> = {
  fadein: "fadeblack", // resolve from black into the next clip
  fadeout: "fadeblack", // dip the outgoing clip to black
  crossfade: "dissolve", // blend between clips
  crosszoom: "zoomin", // zoom into the next clip
  zoomin: "zoomin", // punch-in into the next clip (no fade)
  zoomout: "dissolve", // ffmpeg has no zoomout xfade; dissolve avoids any black/white flash
};

/**
 * Round to the nearest EVEN integer ≥ 2. libx264 with yuv420p requires even width/height;
 * an odd scale target can make ffmpeg error or emit a frame the encoder can't ingest, so
 * every scale/canvas dimension is forced even.
 */
function even(x: number): number {
  const r = Math.max(2, Math.round(x));
  return r % 2 === 0 ? r : r + 1;
}

/** ffmpeg `crop=` prefix for a normalized source region (empty when the whole frame). */
function cropPrefix(c: CropRect | undefined): string {
  return c && c.w > 0 && c.h > 0
    ? `crop=iw*${c.w.toFixed(5)}:ih*${c.h.toFixed(5)}:iw*${c.x.toFixed(5)}:ih*${c.y.toFixed(5)},`
    : "";
}

/**
 * Filter chain for one trimmed video piece in the "video-as-object" model:
 * crop the kept source region → scale it to the segment's box (frame) → overlay onto a
 * black w×h canvas at the box offset. Fill = box overflows (canvas crops); Fit = box
 * inside the canvas (black bars). For a multi-speaker segment (3D), the trimmed source is
 * split into N, each pane cropped to its speaker region and scaled to fill its canvas slot,
 * then all panes overlaid onto the black canvas. Mirrors the preview exactly. Returns chain
 * lines whose final output label is [v{n}].
 */
function framePieceFilters(
  n: number,
  start: string,
  end: string,
  seg: LayoutSegment | undefined,
  srcW: number,
  srcH: number,
  fps: number,
  w: number,
  h: number,
  blurBg?: BlurBackground
): string[] {
  const trim = `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=${fps},setsar=1`;

  // ── Multi-speaker layout: split the source N ways, one face-crop per canvas slot ──
  const panes = seg?.kind && seg.kind !== "single" ? seg.panes : undefined;
  if (panes && panes.length >= 2) {
    const slots = splitSlots(seg!.kind);
    const count = Math.min(panes.length, slots.length, paneCount(seg!.kind));
    const lines: string[] = [];
    const splitLabels = Array.from({ length: count }, (_, i) => `[s${n}_${i}]`).join("");
    lines.push(`${trim},split=${count}${splitLabels}`);
    for (let i = 0; i < count; i++) {
      const slot = slots[i];
      const sw = even(slot.w * w);
      const sh = even(slot.h * h);
      lines.push(`[s${n}_${i}]${cropPrefix(panes[i].crop)}scale=${sw}:${sh}[fg${n}_${i}]`);
    }
    lines.push(`color=c=black:s=${w}x${h}:r=${fps}[bg${n}_0]`);
    for (let i = 0; i < count; i++) {
      const slot = slots[i];
      const sx = Math.round(slot.x * w);
      const sy = Math.round(slot.y * h);
      const inLbl = `[bg${n}_${i}][fg${n}_${i}]`;
      const outLbl = i === count - 1 ? `[v${n}]` : `[bg${n}_${i + 1}]`;
      lines.push(`${inLbl}overlay=${sx}:${sy}:shortest=1${outLbl}`);
    }
    return lines;
  }

  // ── Single frame (default) ──
  const fr = resolveFrame(seg, srcW, srcH, w / h);
  const fw = even(fr.w * w);
  const fh = even(fr.h * h);
  const fx = Math.round(fr.x * w);
  const fy = Math.round(fr.y * h);

  // Auto blurred background: when the foreground leaves bars (Fit), fill the canvas with a
  // cover-scaled, blurred copy of the SAME source frame instead of solid black. Mirrors the
  // preview's blur canvas. Split the trimmed source into a foreground + a background branch.
  const needsBlur = !!blurBg?.enabled && (fr.w < 0.999 || fr.h < 0.999);
  if (needsBlur) {
    const sigma = Math.max(0.5, (blurBg!.blur / 100) * 30).toFixed(2);
    const bright = (blurBg!.brightness - 1).toFixed(2); // eq brightness is additive (-1..1)
    const opacity = Math.min(1, Math.max(0, blurBg!.opacity)).toFixed(2);
    const bw = even(w * Math.max(1, blurBg!.scale));
    const bh = even(h * Math.max(1, blurBg!.scale));
    return [
      `${trim},split=2[fgsrc${n}][bgsrc${n}]`,
      `[fgsrc${n}]${cropPrefix(seg?.crop)}scale=${fw}:${fh}[fg${n}]`,
      `[bgsrc${n}]${cropPrefix(seg?.crop)}scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=${sigma},eq=brightness=${bright}[bgblur${n}]`,
      `color=c=black:s=${w}x${h}:r=${fps}[blk${n}]`,
      `[bgblur${n}]format=yuva420p,colorchannelmixer=aa=${opacity}[bga${n}]`,
      `[blk${n}][bga${n}]overlay=0:0:shortest=1[bg${n}]`,
      `[bg${n}][fg${n}]overlay=${fx}:${fy}:shortest=1[v${n}]`,
    ];
  }

  return [
    `${trim},${cropPrefix(seg?.crop)}scale=${fw}:${fh}[fg${n}]`,
    `color=c=black:s=${w}x${h}:r=${fps}[bg${n}]`,
    `[bg${n}][fg${n}]overlay=${fx}:${fy}:shortest=1[v${n}]`,
  ];
}

function sourcePath(jobId: string): string {
  return path.join(os.tmpdir(), "social-clipper", jobId, "source.mp4");
}

/** "#RRGGBB" → ASS "&HBBGGRR&" (ASS uses BGR order). */
function assColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return "&HFFFFFF&";
  const r = m[1].slice(0, 2), g = m[1].slice(2, 4), b = m[1].slice(4, 6);
  return `&H${(b + g + r).toUpperCase()}&`;
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
    // Per-overlay color + opacity (parity with the preview's text/branding layers).
    const color = o.style.color ? `\\c${assColor(o.style.color)}` : "";
    const alpha = o.style.opacity != null && o.style.opacity < 1
      ? `\\alpha&H${Math.round((1 - o.style.opacity) * 255).toString(16).padStart(2, "0").toUpperCase()}&`
      : "";
    return `Dialogue: 1,${fmtAssTime(o.start)},${fmtAssTime(o.end)},Ov,,0,0,0,,{\\pos(${Math.round(o.x * w)},${Math.round(o.y * h)})\\fs${size}${color}${alpha}}${text}`;
  });
  const p = path.join(dir, "overlays.ass");
  writeFileSync(p, `${header}\n${lines.join("\n")}\n`, "utf-8");
  return p;
}

/**
 * Words mapped into the edited timeline (removed gaps closed), rebased to 0, with
 * per-word `wordStyles` (text edits + highlight color) applied — parity with the
 * preview's `windowWords` (3A).
 */
function editedWords(edit: ClipEdit, words: Word[]): Word[] {
  const styles = edit.wordStyles ?? [];
  const out: Word[] = [];
  for (const w of words) {
    if (w.end <= edit.sourceInSec || w.start >= edit.sourceOutSec) continue;
    const ws = w.start - edit.sourceInSec;
    const we = w.end - edit.sourceInSec;
    if (edit.removed.some((r) => ws < r.end && we > r.start)) continue; // dropped by cleanup
    const st = styles.find((s) => Math.abs(s.t - w.start) < 1e-3);
    out.push({
      text: st?.text ?? w.text,
      start: windowToEdited(edit, ws),
      end: windowToEdited(edit, we),
      color: st?.color,
    });
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
 *   pass 1 — speech cuts + reframe (Fill/Fit) + transitions (xfade/acrossfade) + audio → spine
 *   pass 2 — burn captions + text overlays + mix uploaded audio → final
 * (Media/B-roll compositing in export is a later increment.)
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

  // ── Pass 1: cuts + per-segment reframe → spine.mp4 ──────────────────────────────
  // Split the edited timeline at every kept-segment edge AND every layout (Fill/Fit)
  // boundary, so each emitted piece is uniform in framing and lies inside one kept
  // segment (where edited→source is contiguous). 3C: framing follows edit.layout, not layout[0].
  onProgress({ percent: 10, log: "Cutting & reframing…" });
  const segs = keptSegments(edit);
  if (segs.length === 0) {
    throw new Error("Everything is removed — keep at least some footage before exporting.");
  }
  const { width: srcW, height: srcH, fps: probedFps } = await probe(src);
  const fps = probedFps > 0 ? Math.round(probedFps) : 30;
  const layout = edit.layout ?? [];
  const parts: string[] = [];
  const pieceEditedRanges: { start: number; end: number }[] = []; // each piece's edited-time span
  let n = 0;
  let eAcc = 0; // edited time at the start of the current kept segment
  for (const kp of segs) {
    const ws = kp.start, we = kp.end; // window coords (source = sourceInSec + window)
    const eStart = eAcc, eEnd = eAcc + (we - ws);
    // Cut this kept segment at every layout boundary that falls strictly inside it.
    // Within one kept segment edited↔window is linear, so a layout edge at edited time
    // `edge` maps to window `ws + (edge - eStart)`.
    const cuts = [ws, we];
    for (const l of layout) {
      for (const edge of [l.start, l.end]) {
        if (edge > eStart + 1e-4 && edge < eEnd - 1e-4) cuts.push(ws + (edge - eStart));
      }
    }
    const uniq = [...new Set(cuts.map((c) => +c.toFixed(4)))].sort((a, b) => a - b);
    for (let i = 0; i < uniq.length - 1; i++) {
      const p0 = uniq[i], p1 = uniq[i + 1];
      if (p1 - p0 < 1e-3) continue;
      const start = (edit.sourceInSec + p0).toFixed(3);
      const end = (edit.sourceInSec + p1).toFixed(3);
      const seg = layoutAt(edit, eStart + ((p0 + p1) / 2 - ws));
      parts.push(...framePieceFilters(n, start, end, seg, srcW, srcH, fps, w, h, edit.blurBg));
      parts.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${n}]`);
      // Edited-time span of this piece (within one kept segment, edited↔window is linear).
      pieceEditedRanges.push({ start: eStart + (p0 - ws), end: eStart + (p1 - ws) });
      n++;
    }
    eAcc = eEnd;
  }
  // Stitch the pieces into [vc]/[ac]. At each boundary that has a transition marker (manual
  // or auto, within 0.5s) use xfade/acrossfade so the two pieces overlap by `duration`;
  // otherwise a plain concat (hard cut). Mirrors the preview's transition windows.
  const transitions = allTransitions(edit);
  const chainParts: string[] = [...parts];
  if (n === 1) {
    chainParts.push(`[v0]copy[vc]`);
    chainParts.push(`[a0]acopy[ac]`);
  } else {
    let vCur = "[v0]", aCur = "[a0]";
    let vDurAcc = pieceEditedRanges[0].end - pieceEditedRanges[0].start; // duration of the chain so far
    for (let i = 1; i < n; i++) {
      const boundary = pieceEditedRanges[i - 1].end; // edited time where piece i-1 meets piece i
      const tr = transitions.find((t) => Math.abs(t.atTime - boundary) < 0.5);
      const vNext = `[v${i}]`, aNext = `[a${i}]`;
      const last = i === n - 1;
      const vOut = last ? "[vc]" : `[vx${i}]`;
      const aOut = last ? "[ac]" : `[ax${i}]`;
      const thisDur = pieceEditedRanges[i].end - pieceEditedRanges[i].start;
      // Largest overlap that still fits both neighbouring pieces (xfade needs both streams
      // ≥ duration, and offset = chainSoFar - duration must stay ≥ 0). If even this is below
      // a usable minimum — e.g. a very short piece from a layout/cut boundary — fall back to a
      // hard cut rather than forcing an overlap longer than the piece, which makes ffmpeg error.
      const D = Math.min(tr?.durationSec ?? 0, vDurAcc * 0.9, thisDur * 0.9);
      if (tr && D >= 0.05) {
        const offset = Math.max(0, vDurAcc - D);
        const xType = xfadeMap[tr.type];
        chainParts.push(`${vCur}${vNext}xfade=transition=${xType}:duration=${D.toFixed(3)}:offset=${offset.toFixed(3)}${vOut}`);
        chainParts.push(`${aCur}${aNext}acrossfade=d=${D.toFixed(3)}${aOut}`);
        vDurAcc = vDurAcc - D + thisDur; // overlap shortens the timeline by D
      } else {
        // Hard cut: concat interleaves video+audio per segment ([v][a][v][a]).
        chainParts.push(`${vCur}${aCur}${vNext}${aNext}concat=n=2:v=1:a=1${vOut}${aOut}`);
        vDurAcc += thisDur;
      }
      vCur = vOut; aCur = aOut;
    }
  }
  const filter1 = chainParts.join(";");
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
  // Drop tracks that start at/after the timeline end — amix uses duration=first (the
  // video-length base), so a track delayed past the end would be silently dropped anyway;
  // skipping it avoids a wasted input and a confusing no-op in the graph.
  const spineDur = editedDuration(edit);
  const extraAudio = edit.audio.filter((a) => a.src && Math.max(0, a.start) < spineDur);
  extraAudio.forEach((a) => args.push("-i", a.src));

  const baseVol = edit.muteBase ? "0" : "1.0"; // 3B: mute toggle silences the base video audio
  const aFilters: string[] = [];
  if (extraAudio.length) {
    aFilters.push(`[0:a]volume=${baseVol}[a0]`);
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
  } else if (edit.muteBase) {
    aFilters.push(`[0:a]volume=0[aout]`); // no extra tracks: just silence the base audio
  }

  const filter2parts: string[] = [];
  if (vfilters.length) filter2parts.push(`[0:v]${vfilters.join(",")}[vout]`);
  if (aFilters.length) filter2parts.push(...aFilters);

  const final = path.join(clipMediaDir(), `${edit.clipId}-edited.mp4`);
  // ffmpeg writes to a UNIQUE temp file in the same directory, then we atomically rename it
  // into `final` only on success. This guarantees the served path is never a half-written
  // (or, when two exports of the same clip overlap, byte-interleaved → duplicate-moov)
  // file: a failed/killed render leaves the temp behind, never the served mp4, and concurrent
  // renders each write their own temp so neither corrupts the other's output. The temp lives
  // beside `final` (same volume) so the rename can't fail with EXDEV.
  const tmpFinal = path.join(
    clipMediaDir(),
    `.${edit.clipId}-edited.${process.pid}.${Date.now()}.tmp.mp4`
  );
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
    tmpFinal
  );

  const totalDur = spineDur;
  try {
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
    // Sanity-check the encode actually produced a non-empty file before publishing it.
    if (!existsSync(tmpFinal) || statSync(tmpFinal).size === 0) {
      throw new Error("Export produced an empty file — the render did not complete.");
    }
    // Atomic publish: replace the served file in one step (no reader ever sees a partial mp4).
    renameSync(tmpFinal, final);
  } catch (err) {
    try { rmSync(tmpFinal, { force: true }); } catch { /* best effort */ }
    throw err;
  }

  // Point the Clip at the edited file so results/download/schedule use it (keep original too).
  updateClip(edit.clipId, { filePath: final });
  onProgress({ percent: 100, log: "Done", done: `/api/clip/download/${edit.clipId}` });
  return final;
}
