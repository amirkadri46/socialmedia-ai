"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus } from "lucide-react";
import type { ClipEdit, Word } from "@/lib/types";
import { windowWords, windowDuration } from "@/lib/clip/edit-timeline";

const FILLERS = new Set(["um", "uh", "uhh", "umm", "er", "ah", "like", "hmm", "mmm"]);
const SILENCE_GAP = 0.8; // seconds

export function TranscriptPanel({
  edit,
  words,
  onUpdate,
  onSeek,
}: {
  edit: ClipEdit;
  words: Word[];
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
  onSeek: (windowT: number) => void;
}) {
  const wWords = useMemo(() => windowWords(edit, words), [edit, words]);

  const isWordRemoved = (w: Word) =>
    edit.removed.some((r) => w.start < r.end && w.end > r.start);

  function toggleWord(w: Word) {
    onUpdate((d) => {
      const overlaps = d.removed.findIndex((r) => w.start < r.end && w.end > r.start);
      if (overlaps >= 0) d.removed.splice(overlaps, 1);
      else d.removed.push({ start: w.start, end: w.end });
    });
  }

  function removeSilence(start: number, end: number) {
    onUpdate((d) => {
      d.removed.push({ start, end });
    });
  }

  // Speech cleanup: auto-flag filler words + long silences.
  function speechCleanup() {
    onUpdate((d) => {
      const ranges: { start: number; end: number }[] = [];
      for (const w of wWords) {
        const clean = w.text.replace(/[^a-z']/gi, "").toLowerCase();
        if (FILLERS.has(clean)) ranges.push({ start: w.start, end: w.end });
      }
      for (let i = 0; i < wWords.length - 1; i++) {
        const gap = wWords[i + 1].start - wWords[i].end;
        if (gap >= SILENCE_GAP) ranges.push({ start: wWords[i].end, end: wWords[i + 1].start });
      }
      d.removed = mergeRanges([...d.removed, ...ranges]);
    });
  }

  function extendClip(deltaSec: number, which: "in" | "out") {
    onUpdate((d) => {
      if (which === "in") d.sourceInSec = Math.max(0, d.sourceInSec - deltaSec);
      else d.sourceOutSec = d.sourceOutSec + deltaSec;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Button onClick={speechCleanup} variant="outline">
          <Sparkles className="h-4 w-4" /> Speech cleanup
        </Button>
        <Button onClick={() => extendClip(3, "out")} variant="outline" title="Pull 3s more from the source">
          <Plus className="h-4 w-4" /> Extend a clip
        </Button>
      </div>

      <div className="flex-1 overflow-auto rounded-xl border bg-card p-4 text-[15px] leading-relaxed">
        {wWords.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transcript available for this clip (transcripts are saved for clips rendered after this update).
          </p>
        ) : (
          <p>
            {wWords.map((w, i) => {
              const removed = isWordRemoved(w);
              const gap = i < wWords.length - 1 ? wWords[i + 1].start - w.end : 0;
              return (
                <span key={i}>
                  <button
                    onClick={() => toggleWord(w)}
                    onDoubleClick={() => onSeek(w.start)}
                    title="Click to remove · double-click to seek"
                    className={`rounded px-0.5 transition-colors ${
                      removed
                        ? "text-muted-foreground/40 line-through"
                        : "hover:bg-accent"
                    }`}
                  >
                    {w.text}
                  </button>{" "}
                  {gap >= 0.3 && (
                    <button
                      onClick={() => removeSilence(w.end, w.end + gap)}
                      className="mx-0.5 rounded bg-muted px-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Remove this silence"
                    >
                      {gap.toFixed(2)}s
                    </button>
                  )}
                </span>
              );
            })}
          </p>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Window {windowDuration(edit).toFixed(1)}s · {edit.removed.length} cut{edit.removed.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function mergeRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}
