import type { ClipEdit, TransitionMarker, Word } from "../types";

// Pure time-mapping shared by the browser preview and the ffmpeg export so they
// never diverge (PRD §2). All "window" coords are seconds within [sourceIn, sourceOut];
// "edited" coords are the post-removal playback timeline (0..editedDuration).

export interface Range {
  start: number;
  end: number;
}

export function windowDuration(edit: ClipEdit): number {
  return Math.max(0, edit.sourceOutSec - edit.sourceInSec);
}

/** Kept segments in window coords = [0, windowDuration] minus the removed ranges. */
export function keptSegments(edit: ClipEdit): Range[] {
  const total = windowDuration(edit);
  const removed = [...edit.removed]
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(total, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const kept: Range[] = [];
  let cursor = 0;
  for (const r of removed) {
    if (r.start > cursor) kept.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < total) kept.push({ start: cursor, end: total });
  return kept;
}

export function editedDuration(edit: ClipEdit): number {
  return keptSegments(edit).reduce((sum, s) => sum + (s.end - s.start), 0);
}

/** Map an edited-timeline time to a window time (skipping removed gaps). */
export function editedToWindow(edit: ClipEdit, editedT: number): number {
  let acc = 0;
  for (const seg of keptSegments(edit)) {
    const len = seg.end - seg.start;
    if (editedT <= acc + len) return seg.start + (editedT - acc);
    acc += len;
  }
  // Past the end — clamp to last kept point.
  const segs = keptSegments(edit);
  return segs.length ? segs[segs.length - 1].end : 0;
}

/** Map an edited-timeline time straight to a source-video time. */
export function editedToSource(edit: ClipEdit, editedT: number): number {
  return edit.sourceInSec + editedToWindow(edit, editedT);
}

/** Inverse of editedToWindow: window time → edited-timeline time (kept content only). */
export function windowToEdited(edit: ClipEdit, windowT: number): number {
  let acc = 0;
  for (const seg of keptSegments(edit)) {
    if (windowT < seg.start) return acc; // inside a removed gap → snap to gap start
    if (windowT <= seg.end) return acc + (windowT - seg.start);
    acc += seg.end - seg.start;
  }
  return acc;
}

/** Next kept window time at/after a given window time (skips removed gaps). */
export function nextKeptWindow(edit: ClipEdit, windowT: number): number | null {
  for (const seg of keptSegments(edit)) {
    if (windowT < seg.start) return seg.start;
    if (windowT < seg.end) return windowT;
  }
  return null;
}

/** The active LayoutSegment for an edited-timeline time. */
export function layoutAt(edit: ClipEdit, editedT: number) {
  return (
    edit.layout.find((s) => editedT >= s.start && editedT < s.end) ??
    edit.layout[0]
  );
}

/**
 * Words that fall inside the clip window, rebased to window coords, with per-word
 * `wordStyles` applied (text edits + highlight color). The style key is the word's
 * SOURCE start time, matched with a small tolerance.
 */
export function windowWords(edit: ClipEdit, words: Word[]): Word[] {
  const styles = edit.wordStyles ?? [];
  return words
    .filter((w) => w.end > edit.sourceInSec && w.start < edit.sourceOutSec)
    .map((w) => {
      const st = styles.find((s) => Math.abs(s.t - w.start) < 1e-3);
      return {
        text: st?.text ?? w.text,
        start: w.start - edit.sourceInSec,
        end: w.end - edit.sourceInSec,
        color: st?.color,
      };
    });
}

/** Whether a window time has been removed by speech cleanup. */
export function isRemoved(edit: ClipEdit, windowT: number): boolean {
  return edit.removed.some((r) => windowT >= r.start && windowT < r.end);
}

/**
 * The effective transition list = manual markers, plus (when `autoTransitions` is on)
 * auto-generated crossfades at every layout (Fill/Fit) boundary AND every speech-cleanup
 * cut boundary, all in edited-timeline coords. Auto-markers are dropped when a manual marker
 * already sits within 0.3s. Pure function so the browser preview and the ffmpeg export apply
 * the exact same set (PRD §2 parity).
 */
export function allTransitions(edit: ClipEdit): TransitionMarker[] {
  const manual = edit.transitions ?? [];
  if (!edit.autoTransitions) return manual;

  const autoMarkers: TransitionMarker[] = [];
  // Layout (Fill/Fit / speaker-layout) boundaries — already in edited-timeline coords.
  for (const seg of edit.layout) {
    if (seg.start > 0) {
      autoMarkers.push({ id: `auto-layout-${seg.id}`, atTime: seg.start, type: "crossfade", durationSec: 0.4 });
    }
  }
  // Kept-segment (speech-cleanup cut) boundaries — cumulative edited time between kept pieces.
  const segs = keptSegments(edit);
  let acc = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    acc += segs[i].end - segs[i].start;
    if (acc > 0) autoMarkers.push({ id: `auto-cut-${i}`, atTime: acc, type: "crossfade", durationSec: 0.4 });
  }

  // Manual wins; also dedupe auto-markers against each other within 0.3s.
  const result = [...manual];
  for (const a of autoMarkers) {
    if (!result.some((m) => Math.abs(m.atTime - a.atTime) < 0.3)) result.push(a);
  }
  return result;
}

/** Coalesce overlapping/adjacent ranges (shared by transcript cuts and timeline cuts). */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}
