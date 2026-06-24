"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, Highlighter, Pencil, Trash2, RotateCcw } from "lucide-react";
import type { ClipEdit, Word, WordStyle } from "@/lib/types";
import { editedToWindow, windowDuration } from "@/lib/clip/edit-timeline";

const FILLERS = new Set(["um", "uh", "uhh", "umm", "er", "ah", "like", "hmm", "mmm"]);
const SILENCE_GAP = 0.8; // seconds

const HL1 = "#3BE477"; // Highlight 1 (green)
const HL2 = "#FFD63B"; // Highlight 2 (yellow)

interface DWord {
  i: number;
  src: number; // SOURCE start (stable wordStyles key)
  text: string;
  color?: string;
  ws: number; // window start
  we: number; // window end
  removed: boolean;
}

export function TranscriptPanel({
  edit,
  words,
  onUpdate,
  onSeek,
  playhead,
}: {
  edit: ClipEdit;
  words: Word[];
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
  onSeek: (windowT: number) => void;
  playhead: number; // edited-timeline seconds
}) {
  const styles = edit.wordStyles ?? [];

  // Display list straight from raw words (keeps SOURCE start for keying).
  const dwords: DWord[] = useMemo(() => {
    return words
      .filter((w) => w.end > edit.sourceInSec && w.start < edit.sourceOutSec)
      .map((w, i) => {
        const st = styles.find((s) => Math.abs(s.t - w.start) < 1e-3);
        const ws = w.start - edit.sourceInSec;
        const we = w.end - edit.sourceInSec;
        return {
          i,
          src: w.start,
          text: st?.text ?? w.text,
          color: st?.color,
          ws,
          we,
          removed: edit.removed.some((r) => ws < r.end && we > r.start),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, edit.sourceInSec, edit.sourceOutSec, edit.wordStyles, edit.removed]);

  // ── Live highlight + auto-scroll ──────────────────────────────────────────────
  const winT = editedToWindow(edit, playhead);
  const activeIdx = dwords.findIndex((d) => winT >= d.ws && winT < d.we);
  const activeRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // ── Selection / drag-select ───────────────────────────────────────────────────
  const [sel, setSel] = useState<{ lo: number; hi: number } | null>(null);
  // popup anchor is stored in VIEWPORT coords so it can be position:fixed and never
  // get clipped by the transcript's overflow-auto container.
  const [popup, setPopup] = useState<{ cx: number; top: number; bottom: number; focus: number } | null>(null);
  const [hlOpen, setHlOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const drag = useRef<{ anchor: number; moved: boolean } | null>(null);
  // Stable refs so the pointerup handler doesn't re-register on every sel/dwords change during a drag.
  const selRef = useRef(sel);
  selRef.current = sel;
  const dwordsRef = useRef(dwords);
  dwordsRef.current = dwords;
  const containerRef = useRef<HTMLDivElement>(null);
  const wordEls = useRef<Map<number, HTMLSpanElement>>(new Map());

  function closePopup() {
    setPopup(null);
    setHlOpen(false);
    setShowPicker(false);
    setEditing(null);
  }

  function openPopupAt(focusEl: HTMLElement | null, focusIdx: number) {
    if (!focusEl) return;
    const wr = focusEl.getBoundingClientRect();
    setPopup({ cx: wr.left + wr.width / 2, top: wr.top, bottom: wr.bottom, focus: focusIdx });
  }

  // Clamp the fixed popup inside the viewport once it (or its open submenu) is measured.
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!popup) { setPopupPos(null); return; }
    const el = popupRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = popup.cx - r.width / 2;
    left = Math.min(window.innerWidth - 8 - r.width, Math.max(8, left));
    let top = popup.top - 8 - r.height; // above the word
    if (top < 8) top = popup.bottom + 8; // flip below if no room above
    setPopupPos({ left, top });
  }, [popup, hlOpen, showPicker]);

  // Pointer drag-select on the word container.
  function onWordPointerDown(e: React.PointerEvent, idx: number) {
    if (editing !== null) return;
    e.preventDefault();
    closePopup();
    drag.current = { anchor: idx, moved: false };
    setSel({ lo: idx, hi: idx });
  }
  function onWordPointerEnter(idx: number) {
    if (!drag.current) return;
    drag.current.moved = drag.current.moved || idx !== drag.current.anchor;
    const a = drag.current.anchor;
    setSel({ lo: Math.min(a, idx), hi: Math.max(a, idx) });
  }
  useEffect(() => {
    function onUp() {
      if (!drag.current) return;
      const d = drag.current;
      drag.current = null;
      const cur = selRef.current;
      if (!cur) return;
      if (cur.lo === cur.hi && !d.moved) {
        const w = dwordsRef.current[cur.lo];
        if (w) onSeek(w.ws); // single click → seek
      }
      const el = wordEls.current.get(cur.hi) ?? null;
      openPopupAt(el, cur.hi);
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable registration — reads latest sel/dwords via refs, no re-registration during drag

  // Close popup on Esc / outside click.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { closePopup(); setSel(null); }
    }
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("[data-transcript-popup]") || t.closest("[data-word]")) return;
      closePopup();
      setSel(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  function selectedWords(): DWord[] {
    if (!sel) return [];
    return dwords.filter((d) => d.i >= sel.lo && d.i <= sel.hi);
  }

  function applyColor(color: string | undefined, opts?: { keepOpen?: boolean }) {
    const targets = selectedWords();
    onUpdate((d) => {
      const list: WordStyle[] = d.wordStyles ?? (d.wordStyles = []);
      for (const w of targets) {
        const ex = list.find((s) => Math.abs(s.t - w.src) < 1e-3);
        if (color === undefined) {
          if (ex) {
            ex.color = undefined;
            if (ex.text === undefined) list.splice(list.indexOf(ex), 1);
          }
        } else if (ex) ex.color = color;
        else list.push({ t: w.src, color });
      }
    });
    if (!opts?.keepOpen) closePopup();
  }

  function commitEdit(srcKey: number, newText: string) {
    onUpdate((d) => {
      const list: WordStyle[] = d.wordStyles ?? (d.wordStyles = []);
      const ex = list.find((s) => Math.abs(s.t - srcKey) < 1e-3);
      if (ex) ex.text = newText;
      else list.push({ t: srcKey, text: newText });
    });
    closePopup();
  }

  function deleteOrRestore() {
    const targets = selectedWords();
    if (!targets.length) return;
    const allRemoved = targets.every((w) => w.removed);
    onUpdate((d) => {
      if (allRemoved) {
        // Split each overlapping removed range around the restored words rather than
        // deleting the entire merged range (which would restore adjacent deleted words too).
        let ranges = [...d.removed];
        for (const w of targets) {
          const next: { start: number; end: number }[] = [];
          for (const r of ranges) {
            if (w.ws >= r.end || w.we <= r.start) {
              next.push(r); // no overlap — keep as-is
            } else {
              if (r.start < w.ws) next.push({ start: r.start, end: w.ws });
              if (r.end > w.we) next.push({ start: w.we, end: r.end });
            }
          }
          ranges = next;
        }
        d.removed = ranges;
      } else {
        for (const w of targets) d.removed.push({ start: w.ws, end: w.we });
        d.removed = mergeRanges(d.removed);
      }
    });
    closePopup();
    setSel(null);
  }

  // ── Existing helpers (kept) ───────────────────────────────────────────────────
  function removeSilence(start: number, end: number) {
    onUpdate((d) => { d.removed.push({ start, end }); d.removed = mergeRanges(d.removed); });
  }

  function speechCleanup() {
    onUpdate((d) => {
      const ranges: { start: number; end: number }[] = [];
      for (const w of dwords) {
        const clean = w.text.replace(/[^a-z']/gi, "").toLowerCase();
        if (FILLERS.has(clean)) ranges.push({ start: w.ws, end: w.we });
      }
      for (let i = 0; i < dwords.length - 1; i++) {
        const gap = dwords[i + 1].ws - dwords[i].we;
        if (gap >= SILENCE_GAP) ranges.push({ start: dwords[i].we, end: dwords[i + 1].ws });
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

  const oneSelected = sel && sel.lo === sel.hi;
  const sw = selectedWords();
  const allSelRemoved = sw.length > 0 && sw.every((w) => w.removed);
  const pickerInitial = sw.find((w) => w.color)?.color ?? HL1;

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

      <div
        ref={containerRef}
        className="relative flex-1 select-none overflow-auto rounded-xl border bg-card p-4 text-[17px] leading-[1.9]"
      >
        {dwords.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No transcript available for this clip (transcripts are saved for clips rendered after this update).
          </p>
        ) : (
          <p>
            {dwords.map((w, i) => {
              const inSel = sel && w.i >= sel.lo && w.i <= sel.hi;
              const active = i === activeIdx;
              const gap = i < dwords.length - 1 ? dwords[i + 1].ws - w.we : 0;
              if (editing === w.i) {
                return (
                  <InlineEdit
                    key={w.i}
                    initial={w.text}
                    onCommit={(v) => commitEdit(w.src, v)}
                    onCancel={() => { setEditing(null); closePopup(); }}
                  />
                );
              }
              return (
                <span key={w.i}>
                  <span
                    data-word
                    ref={(el) => {
                      if (el) wordEls.current.set(w.i, el);
                      else wordEls.current.delete(w.i);
                      if (active) activeRef.current = el;
                    }}
                    onPointerDown={(e) => onWordPointerDown(e, w.i)}
                    onPointerEnter={() => onWordPointerEnter(w.i)}
                    className={`cursor-text rounded px-0.5 transition-colors ${
                      w.removed ? "text-muted-foreground/40 line-through" : ""
                    } ${inSel ? "bg-primary/30" : !active ? "hover:bg-accent/60" : ""} ${
                      active ? "font-semibold" : ""
                    }`}
                    style={
                      active
                        ? { background: "rgba(255,255,255,0.95)", color: w.color ?? "#0a0a0a", borderRadius: 4 }
                        : w.color
                        ? { color: w.color }
                        : undefined
                    }
                  >
                    {w.text}
                  </span>{" "}
                  {gap >= 0.3 && (
                    <button
                      onClick={() => removeSilence(w.we, w.we + gap)}
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
        {" · "}click a word to seek · drag to select
      </p>

      {/* Selection popup toolbar — fixed to the viewport, clamped on screen */}
      {popup && sel && (
        <div
          ref={popupRef}
          data-transcript-popup
          style={{
            position: "fixed",
            left: popupPos?.left ?? -9999,
            top: popupPos?.top ?? -9999,
            zIndex: 60,
            visibility: popupPos ? "visible" : "hidden",
          }}
        >
          <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
            <div className="relative">
              <button
                onClick={() => { setHlOpen((o) => !o); setShowPicker(false); }}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent"
              >
                <Highlighter className="h-3.5 w-3.5" /> Highlight
              </button>
              {hlOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border bg-popover p-1 shadow-xl">
                  <ColorRow label="Highlight 1" color={HL1} onClick={() => applyColor(HL1)} />
                  <ColorRow label="Highlight 2" color={HL2} onClick={() => applyColor(HL2)} />
                  <button
                    onClick={() => setShowPicker((p) => !p)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full border bg-linear-to-br from-red-500 via-green-500 to-blue-500" />
                      Font color
                    </span>
                  </button>
                  {showPicker && (
                    <div className="px-1 py-1">
                      <HsvColorPicker
                        initial={pickerInitial}
                        onCommit={(hex) => applyColor(hex, { keepOpen: true })}
                      />
                    </div>
                  )}
                  <button
                    onClick={() => applyColor(undefined)}
                    className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <button
              disabled={!oneSelected}
              onClick={() => { if (oneSelected && sel) setEditing(sel.lo); }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent disabled:opacity-40"
              title={oneSelected ? "Edit word" : "Select a single word to edit"}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            <button
              onClick={deleteOrRestore}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent"
            >
              {allSelRemoved ? (
                <><RotateCcw className="h-3.5 w-3.5" /> Restore</>
              ) : (
                <><Trash2 className="h-3.5 w-3.5" /> Delete</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ColorRow({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent">
      <span className="h-3.5 w-3.5 rounded-full border" style={{ background: color }} />
      {label}
    </button>
  );
}

function InlineEdit({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v.trim() || initial)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(v.trim() || initial); }
        else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      className="mx-0.5 inline-block w-24 rounded border bg-background px-1 text-[17px] outline-none ring-1 ring-primary"
      style={{ width: `${Math.max(3, v.length + 1)}ch` }}
    />
  );
}

// ── Draggable HSV color picker ─────────────────────────────────────────────────
// A saturation/value square + hue slider, both pointer-draggable. Commits the picked
// color only on pointer-up so a drag is one undo step (not one per move).
function HsvColorPicker({ initial, onCommit }: { initial: string; onCommit: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(initial));
  const latest = useRef(hsv);
  const set = (next: { h: number; s: number; v: number }) => { latest.current = next; setHsv(next); };
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);

  function dragSV(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const apply = (cx: number, cy: number) =>
      set({ ...latest.current, s: clamp01((cx - r.left) / r.width), v: 1 - clamp01((cy - r.top) / r.height) });
    apply(e.clientX, e.clientY);
    const mm = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", mm);
      window.removeEventListener("pointerup", up);
      onCommit(hsvToHex(latest.current.h, latest.current.s, latest.current.v));
    };
    window.addEventListener("pointermove", mm);
    window.addEventListener("pointerup", up);
  }

  function dragHue(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const apply = (cx: number) => set({ ...latest.current, h: clamp01((cx - r.left) / r.width) * 360 });
    apply(e.clientX);
    const mm = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", mm);
      window.removeEventListener("pointerup", up);
      onCommit(hsvToHex(latest.current.h, latest.current.s, latest.current.v));
    };
    window.addEventListener("pointermove", mm);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="w-44 select-none space-y-2">
      <div
        onPointerDown={dragSV}
        className="relative h-24 w-full cursor-crosshair rounded"
        style={{
          backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
          backgroundImage:
            "linear-gradient(to right, #fff, rgba(255,255,255,0)), linear-gradient(to top, #000, rgba(0,0,0,0))",
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
        />
      </div>
      <div
        onPointerDown={dragHue}
        className="relative h-3 w-full cursor-pointer rounded"
        style={{
          backgroundImage:
            "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white shadow"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="h-5 w-5 rounded border" style={{ background: hex }} />
        <span className="font-mono text-[11px] uppercase text-muted-foreground">{hex}</span>
      </div>
    </div>
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const h2 = hex.replace("#", "");
  const r = parseInt(h2.slice(0, 2), 16) / 255;
  const g = parseInt(h2.slice(2, 4), 16) / 255;
  const b = parseInt(h2.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
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
