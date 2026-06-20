import type { ClipEdit, Word } from "../types";

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

/** Words that fall inside the clip window, rebased to window coords. */
export function windowWords(edit: ClipEdit, words: Word[]): Word[] {
  return words
    .filter((w) => w.end > edit.sourceInSec && w.start < edit.sourceOutSec)
    .map((w) => ({
      text: w.text,
      start: w.start - edit.sourceInSec,
      end: w.end - edit.sourceInSec,
    }));
}

/** Whether a window time has been removed by speech cleanup. */
export function isRemoved(edit: ClipEdit, windowT: number): boolean {
  return edit.removed.some((r) => windowT >= r.start && windowT < r.end);
}
