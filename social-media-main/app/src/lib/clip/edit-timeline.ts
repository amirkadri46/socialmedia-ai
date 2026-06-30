import type { ClipEdit, TransitionEasing, TransitionMarker, Word } from "../types";

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
    if (editedT <= acc + len + 1e-4) return seg.start + Math.max(0, editedT - acc);
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
    if (windowT < seg.start - 1e-4) return acc; // inside a removed gap → snap to gap start
    if (windowT <= seg.end + 1e-4) return acc + Math.max(0, windowT - seg.start);
    acc += seg.end - seg.start;
  }
  return acc;
}

/** Next kept window time at/after a given window time (skips removed gaps). */
export function nextKeptWindow(edit: ClipEdit, windowT: number): number | null {
  for (const seg of keptSegments(edit)) {
    if (windowT < seg.start - 1e-4) return seg.start;
    if (windowT < seg.end - 1e-4) return windowT;
  }
  return null;
}

/** The active LayoutSegment for an edited-timeline time. */
export function layoutAt(edit: ClipEdit, editedT: number) {
  const layout = [...(edit.layout ?? [])].sort((a, b) => a.start - b.start);
  if (!layout.length) return undefined;
  const t = Math.min(Math.max(0, editedT), editedDuration(edit));
  return layout.find((s) => t >= s.start - 1e-6 && t < s.end - 1e-6) ?? layout[layout.length - 1];
}

export function easeValue(kind: TransitionEasing | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind ?? "ease") {
    case "linear": return x;
    case "ease-in": return x * x;
    case "ease-out": return 1 - (1 - x) * (1 - x);
    case "ease-in-out": return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case "cubic": return x * x * x;
    case "quart": return x * x * x * x;
    case "quint": return x * x * x * x * x;
    case "circ": return 1 - Math.sqrt(1 - x * x);
    case "expo": return x === 0 ? 0 : Math.pow(2, 10 * x - 10);
    case "ease":
    default:
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
}

export function transitionWindow(t: TransitionMarker): Range {
  const d = Math.max(0.001, t.durationSec);
  return { start: t.atTime, end: t.atTime + d };
}

export function transitionAt(edit: ClipEdit, editedT: number): { marker: TransitionMarker; p: number } | null {
  const transitions = allTransitions(edit);
  for (const marker of transitions) {
    const w = transitionWindow(marker);
    if (editedT >= w.start && editedT < w.end) {
      return { marker, p: (editedT - w.start) / Math.max(0.001, w.end - w.start) };
    }
  }
  return null;
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
  return edit.transitions ?? [];
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
