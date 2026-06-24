"use client";

import { useEffect, useRef, useState } from "react";
import { Blend, X } from "lucide-react";
import type { ClipEdit, TransitionMarker } from "@/lib/types";
import { allTransitions, editedDuration, editedToSource } from "@/lib/clip/edit-timeline";

const TRANSITION_LABELS: Record<TransitionMarker["type"], string> = {
  fadein: "Fade in",
  fadeout: "Fade out",
  crossfade: "Cross fade",
  crosszoom: "Cross zoom",
  zoomin: "Zoom in",
  zoomout: "Zoom out",
};

// 3.6s → "00:03.6"
function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

type MovableKind = "text" | "media" | "broll" | "audio";

// "layout" = a Fill/Fit framing segment (selectable on the video track to trim/delete it).
export type TimelineItem = { kind: MovableKind | "layout"; id: string };

export interface FilmstripMeta {
  frameCount: number;
  frameW: number;
  frameH: number;
  intervalSec: number;
  sourceDurationSec: number;
  sourceFps: number;
}

export interface Selection { start: number; end: number }

const VIDEO_H = 56;
const AUDIO_H = 44;

export function Timeline({
  jobId,
  edit,
  playhead,
  pxPerSec,
  onSeek,
  onZoom,
  onUpdate,
  selection,
  onSelection,
  selectedItem,
  onSelectItem,
  onMeta,
}: {
  jobId: string;
  edit: ClipEdit;
  playhead: number;
  pxPerSec: number;
  onSeek: (t: number) => void;
  onZoom: (dir: 1 | -1) => void;
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
  selection: Selection | null;
  onSelection: (sel: Selection | null) => void;
  selectedItem?: TimelineItem | null;
  onSelectItem?: (item: TimelineItem | null) => void;
  onMeta?: (meta: FilmstripMeta) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const duration = editedDuration(edit);
  const width = Math.max(duration * pxPerSec, 200);

  const [film, setFilm] = useState<FilmstripMeta | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const spriteUrl = `/api/clip/${jobId}/filmstrip`;

  // Fetch filmstrip geometry + waveform once per job.
  useEffect(() => {
    let alive = true;
    fetch(`/api/clip/${jobId}/filmstrip?meta=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (alive && m) { setFilm(m); onMeta?.(m); } })
      .catch(() => {});
    fetch(`/api/clip/${jobId}/waveform`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.peaks) setPeaks(d.peaks); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Ctrl/⌘ + wheel = zoom; plain wheel scrolls natively.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoom]);

  // Draw the amplitude-envelope waveform (mapped edited→source so cuts stay in sync).
  useEffect(() => {
    const cv = waveRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    cv.width = Math.ceil(width);
    cv.height = AUDIO_H;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!peaks || !peaks.length || !film) return;
    const srcDur = film.sourceDurationSec || 1;
    const mid = AUDIO_H / 2;
    ctx.fillStyle = "rgba(120,120,130,0.55)";
    for (let x = 0; x < width; x += 2) {
      const editedT = x / pxPerSec;
      if (editedT > duration) break;
      const srcT = editedToSource(edit, editedT);
      const idx = Math.min(peaks.length - 1, Math.max(0, Math.floor((srcT / srcDur) * peaks.length)));
      const h = Math.max(1, peaks[idx] * (AUDIO_H - 4));
      ctx.fillRect(x, mid - h / 2, 1.5, h);
    }
  }, [peaks, film, width, pxPerSec, duration, edit]);

  function timeAtClientX(clientX: number): number {
    const el = innerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(duration, Math.max(0, (clientX - rect.left) / pxPerSec));
  }

  // Ruler: drag to scrub the playhead (continuous).
  function startScrub(e: React.PointerEvent) {
    e.stopPropagation();
    onSeek(timeAtClientX(e.clientX));
    const move = (ev: PointerEvent) => onSeek(timeAtClientX(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Track body: drag to select a range; a plain click seeks.
  function startBody(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startT = timeAtClientX(startX);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      const t = timeAtClientX(ev.clientX);
      onSelection({ start: Math.min(startT, t), end: Math.max(startT, t) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) { onSelection(null); onSelectItem?.(null); onSeek(startT); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Trim the whole clip in/out by dragging the video-track end handles.
  function startClipTrim(edge: "in" | "out") {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startIn = edit.sourceInSec;
      const startOut = edit.sourceOutSec;
      const srcDur = film?.sourceDurationSec ?? startOut;
      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / pxPerSec;
        onUpdate((d) => {
          if (edge === "in") d.sourceInSec = Math.min(startOut - 0.5, Math.max(0, startIn + delta));
          else d.sourceOutSec = Math.max(startIn + 0.5, Math.min(srcDur, startOut + delta));
        });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  function listFor(d: ClipEdit, kind: MovableKind) {
    return (kind === "text" ? d.textOverlays : kind === "media" ? d.mediaOverlays : kind === "broll" ? d.broll : d.audio) as { id: string; start: number; end: number }[];
  }

  function startTrim(kind: MovableKind, id: string, segStart: number, segEnd: number) {
    return (edge: "start" | "end") => (e: React.PointerEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / pxPerSec;
        onUpdate((d) => {
          const seg = listFor(d, kind).find((x) => x.id === id);
          if (!seg) return;
          if (edge === "start") seg.start = Math.min(segEnd - 0.2, Math.max(0, segStart + delta));
          else seg.end = Math.max(segStart + 0.2, Math.min(duration, segEnd + delta));
        });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  function startSegDrag(kind: MovableKind, id: string, segStart: number, segEnd: number) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const len = segEnd - segStart;
      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / pxPerSec;
        const ns = Math.min(duration - len, Math.max(0, segStart + delta));
        onUpdate((d) => {
          const seg = listFor(d, kind).find((x) => x.id === id);
          if (seg) { seg.start = ns; seg.end = ns + len; }
        });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Drag the boundary between two adjacent layout (Fill/Fit) segments — moves the cut.
  function startDivider(leftId: string, rightId: string, boundary: number) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / pxPerSec;
        onUpdate((d) => {
          const li = d.layout.find((s) => s.id === leftId);
          const ri = d.layout.find((s) => s.id === rightId);
          if (!li || !ri) return;
          const nb = Math.min(ri.end - 0.2, Math.max(li.start + 0.2, boundary + delta));
          li.end = nb;
          ri.start = nb;
        });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Drag a manual transition chip to move its boundary (atTime); a click seeks to it.
  function startTransitionDrag(id: string, atTime: number) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > 3) moved = true;
        const delta = (ev.clientX - startX) / pxPerSec;
        onUpdate((d) => {
          const m = d.transitions.find((x) => x.id === id);
          if (m) m.atTime = Math.min(duration, Math.max(0, atTime + delta));
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (!moved) onSeek(atTime);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Drag a transition chip's left/right edge to change its duration (symmetric about the
  // boundary). Goes down to MIN_TRANS_DUR (50ms) for tight, millisecond-level control.
  const MIN_TRANS_DUR = 0.05;
  function startTransitionTrim(id: string, atTime: number, durationSec: number) {
    return (edge: "start" | "end") => (e: React.PointerEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const halfStart = durationSec / 2;
      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / pxPerSec;
        // Dragging an edge outward grows the half-width; inward shrinks it.
        const half = edge === "end" ? halfStart + delta : halfStart - delta;
        const nd = Math.max(MIN_TRANS_DUR, Math.min(duration, half * 2));
        onUpdate((d) => {
          const m = d.transitions.find((x) => x.id === id);
          if (m) m.durationSec = Math.round(nd * 1000) / 1000;
        });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Trim handle on a selected framing segment: an inner edge re-times the shared cut
  // (startDivider); an outer edge trims the whole clip in/out (startClipTrim).
  function startLayoutEdge(seg: { id: string; start: number; end: number }, edge: "start" | "end") {
    return (e: React.PointerEvent) => {
      const sorted = [...edit.layout].sort((a, b) => a.start - b.start);
      const idx = sorted.findIndex((s) => s.id === seg.id);
      const prev = sorted[idx - 1];
      const next = sorted[idx + 1];
      if (edge === "start") return prev ? startDivider(prev.id, seg.id, seg.start)(e) : startClipTrim("in")(e);
      return next ? startDivider(seg.id, next.id, seg.end)(e) : startClipTrim("out")(e);
    };
  }

  const ticks: number[] = [];
  const step = pxPerSec < 25 ? 10 : 5;
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  // Filmstrip columns mapped edited→source (so removed gaps don't show stale frames).
  const colW = film ? film.intervalSec * pxPerSec : 0;
  const cols: { left: number; w: number; frameIdx: number }[] = [];
  if (film && film.intervalSec > 0) {
    const n = Math.ceil(duration / film.intervalSec);
    for (let i = 0; i < n; i++) {
      const srcT = editedToSource(edit, i * film.intervalSec);
      const frameIdx = Math.min(film.frameCount - 1, Math.max(0, Math.round(srcT / film.intervalSec)));
      cols.push({ left: i * colW, w: colW + 1, frameIdx });
    }
  }

  // Overlays lane: text / media / B-roll packed into stacked rows so overlapping
  // items never share the same layer (a newly added item lands on its own row).
  const OVERLAY_ROW_H = 26;
  type OverlayEntry = { kind: MovableKind; id: string; start: number; end: number; label: string; className: string };
  const overlayEntries: OverlayEntry[] = [
    ...edit.textOverlays.map((o) => ({
      kind: "text" as const, id: o.id, start: o.start, end: o.end,
      label: o.text.slice(0, 14) || "Text", className: "bg-emerald-500/25 border-emerald-400/50",
    })),
    ...edit.mediaOverlays.map((m) => ({
      kind: "media" as const, id: m.id, start: m.start, end: m.end,
      label: m.kind, className: "bg-foreground/15 border-foreground/30",
    })),
    ...edit.broll.map((b) => ({
      kind: "broll" as const, id: b.id, start: b.start, end: b.end,
      label: "B-roll", className: "bg-sky-500/25 border-sky-400/50",
    })),
  ].sort((a, b) => a.start - b.start);
  const rowEnds: number[] = [];
  const packedOverlays = overlayEntries.map((it) => {
    let row = rowEnds.findIndex((end) => it.start >= end - 1e-3);
    if (row === -1) { row = rowEnds.length; rowEnds.push(it.end); }
    else rowEnds[row] = it.end;
    return { ...it, row };
  });
  const overlayRows = Math.max(1, rowEnds.length);

  // Transitions sit centered on their boundary (atTime), width = duration. Pack colliding
  // chips into stacked rows so they never overlap.
  const TRANS_ROW_H = 22;
  const TRANS_MIN_W = 78;
  const transEntries = allTransitions(edit)
    .map((t) => ({ t, center: t.atTime * pxPerSec, w: Math.max(TRANS_MIN_W, t.durationSec * pxPerSec) }))
    .sort((a, b) => a.center - b.center);
  const transRowEnds: number[] = [];
  const packedTransitions = transEntries.map((it) => {
    const startPx = it.center - it.w / 2;
    let row = transRowEnds.findIndex((end) => startPx >= end - 1);
    if (row === -1) { row = transRowEnds.length; transRowEnds.push(it.center + it.w / 2); }
    else transRowEnds[row] = it.center + it.w / 2;
    return { ...it, row };
  });
  const transRows = Math.max(1, transRowEnds.length);

  function selectAndDrag(kind: MovableKind, id: string, start: number, end: number) {
    return (e: React.PointerEvent) => {
      onSelectItem?.({ kind, id });
      startSegDrag(kind, id, start, end)(e);
    };
  }

  return (
    <div ref={scrollRef} className="relative overflow-auto" style={{ maxHeight: 300 }}>
      {/* Whole body is the marquee/seek surface; specific controls stopPropagation. */}
      <div ref={innerRef} style={{ width }} className="relative select-none" onPointerDown={startBody}>
        {/* Ruler (scrub) */}
        <div className="relative h-6 cursor-ew-resize border-b" onPointerDown={startScrub}>
          {ticks.map((t) => (
            <span key={t} className="pointer-events-none absolute top-1 text-[10px] text-muted-foreground" style={{ left: t * pxPerSec }}>
              {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
            </span>
          ))}
        </div>

        {/* Captions lane (top) */}
        <Lane label="Captions">
          {edit.caption.enabled && (
            <Seg left={0} width={duration * pxPerSec} className="bg-foreground/20 border-foreground/35">{edit.caption.preset}</Seg>
          )}
        </Lane>

        {/* Overlays lane: text / media / B-roll — stacked rows, above the video */}
        <div className="relative border-b" style={{ height: overlayRows * OVERLAY_ROW_H + 8 }}>
          <span className="pointer-events-none absolute left-1 top-0.5 z-10 text-[9px] uppercase tracking-wider text-muted-foreground/50">Overlays</span>
          {packedOverlays.map((it) => {
            const selected = selectedItem?.kind === it.kind && selectedItem.id === it.id;
            return (
              <Seg
                key={`${it.kind}-${it.id}`}
                draggable
                top={4 + it.row * OVERLAY_ROW_H}
                height={OVERLAY_ROW_H - 4}
                left={it.start * pxPerSec}
                width={Math.max(20, (it.end - it.start) * pxPerSec)}
                className={`${it.className} ${selected ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : ""}`}
                onPointerDown={selectAndDrag(it.kind, it.id, it.start, it.end)}
                trim={startTrim(it.kind, it.id, it.start, it.end)}
              >
                {it.label}
              </Seg>
            );
          })}
        </div>

        {/* Transitions lane — chips centered on their boundary; drag body to move, drag an
            edge to trim duration (manual). Auto transitions render dimmed and read-only. */}
        <div className="relative border-b" style={{ height: transRows * TRANS_ROW_H + 6 }}>
          <span className="pointer-events-none absolute left-1 top-0.5 z-10 text-[9px] uppercase tracking-wider text-muted-foreground/50">Transitions</span>
          {packedTransitions.map(({ t, w, row }) => {
            const isAuto = t.id.startsWith("auto-");
            return (
              <div
                key={t.id}
                onPointerDown={(e) => { e.stopPropagation(); if (isAuto) onSeek(t.atTime); else startTransitionDrag(t.id, t.atTime)(e); }}
                title={`${TRANSITION_LABELS[t.type]} · ${(t.durationSec * 1000).toFixed(0)}ms`}
                className={`group absolute z-10 flex h-4.5 -translate-x-1/2 items-center justify-center gap-1 overflow-hidden border px-2 text-[10px] font-semibold ${
                  isAuto
                    ? "border-foreground/20 bg-foreground/10 text-muted-foreground"
                    : "cursor-grab border-primary/60 bg-primary/30 text-foreground active:cursor-grabbing"
                }`}
                style={{ left: t.atTime * pxPerSec, width: w, top: 4 + row * TRANS_ROW_H }}
              >
                <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground opacity-0 shadow group-hover:opacity-100">
                  {fmtDur(t.durationSec)}
                </span>
                {!isAuto && (
                  <span
                    onPointerDown={startTransitionTrim(t.id, t.atTime, t.durationSec)("start")}
                    title="Trim duration"
                    className="absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize bg-primary/60 opacity-0 group-hover:opacity-100"
                  />
                )}
                <Blend className="h-3 w-3 shrink-0" />
                <span className="truncate">{TRANSITION_LABELS[t.type]}</span>
                {!isAuto && (
                  <>
                    <span
                      onPointerDown={startTransitionTrim(t.id, t.atTime, t.durationSec)("end")}
                      title="Trim duration"
                      className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize bg-primary/60 opacity-0 group-hover:opacity-100"
                    />
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onUpdate((d) => { d.transitions = d.transitions.filter((x) => x.id !== t.id); }); }}
                      title="Remove transition"
                      className="absolute right-2 top-1/2 hidden -translate-y-1/2 text-muted-foreground hover:text-destructive group-hover:block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Fill/Fit lane — chips SELECT the segment (set the mode on the preview toolbar) */}
        <Lane label="Framing">
          {edit.layout.map((s) => {
            const active = playhead >= s.start && playhead < s.end;
            const selected = selectedItem?.kind === "layout" && selectedItem.id === s.id;
            return (
              <button
                key={s.id}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => { onSelectItem?.({ kind: "layout", id: s.id }); onSeek(s.start); }}
                title="Select this layer — toggle Fill / Fit on the preview, or Delete to merge it"
                className={`absolute top-1 bottom-1 flex items-center overflow-hidden border px-2 text-[10px] font-semibold transition-colors ${
                  s.mode === "fill"
                    ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-100"
                    : "border-sky-400/60 bg-sky-500/25 text-sky-100"
                } ${selected || active ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : ""}`}
                style={{ left: s.start * pxPerSec + 1, width: Math.max(20, (s.end - s.start) * pxPerSec - 2) }}
              >
                {s.kind === "split" ? "Split" : s.kind === "triple" ? "Triple" : s.kind === "quad" ? "Quad" : s.mode === "fill" ? "Fill" : "Fit"}
              </button>
            );
          })}
        </Lane>

        {/* Video track: filmstrip + clip trim handles + cut dividers (from C / Split) */}
        <div className="relative border-b bg-muted/30" style={{ height: VIDEO_H }}>
          <span className="pointer-events-none absolute left-1 top-0.5 z-20 text-[9px] uppercase tracking-wider text-muted-foreground/50">Video</span>
          {film && cols.map((c, i) => (
            <div
              key={i}
              className="pointer-events-none absolute top-0 bottom-0"
              style={{
                left: c.left,
                width: c.w,
                backgroundImage: `url(${spriteUrl})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${film.frameCount * colW}px ${VIDEO_H}px`,
                backgroundPosition: `${-c.frameIdx * colW}px 0px`,
              }}
            />
          ))}
          {/* Selectable video segments: click to select; a selected segment shows trim
              handles on each side (drag = re-time the cut / trim the clip in-out). */}
          {edit.layout.map((s) => {
            const selected = selectedItem?.kind === "layout" && selectedItem.id === s.id;
            return (
              <div
                key={`seg-${s.id}`}
                onPointerDown={(e) => { e.stopPropagation(); onSelectItem?.({ kind: "layout", id: s.id }); onSeek(s.start); }}
                title="Select this segment"
                className={`absolute top-0 bottom-0 z-20 ${selected ? "border-2 border-primary bg-primary/10" : "border-x border-transparent hover:border-foreground/40"}`}
                style={{ left: s.start * pxPerSec, width: Math.max(8, (s.end - s.start) * pxPerSec) }}
              >
                {selected && (
                  <>
                    <span onPointerDown={startLayoutEdge(s, "start")} title="Trim" className="absolute left-0 top-0 bottom-0 z-40 flex w-2.5 cursor-ew-resize items-center justify-center bg-primary">
                      <span className="h-3 w-px bg-primary-foreground/80" />
                    </span>
                    <span onPointerDown={startLayoutEdge(s, "end")} title="Trim" className="absolute right-0 top-0 bottom-0 z-40 flex w-2.5 cursor-ew-resize items-center justify-center bg-primary">
                      <span className="h-3 w-px bg-primary-foreground/80" />
                    </span>
                  </>
                )}
              </div>
            );
          })}
          {/* Cut dividers: each splits the video into clips you can drag to re-time the cut */}
          {(() => {
            const sorted = [...edit.layout].sort((a, b) => a.start - b.start);
            return sorted.slice(1).map((next, idx) => {
              const s = sorted[idx];
              if (Math.abs(s.end - next.start) > 0.01) return null; // not adjacent
              return (
                <span
                  key={`cut-${s.id}`}
                  onPointerDown={startDivider(s.id, next.id, s.end)}
                  title="Drag to move the cut"
                  className="group absolute top-0 bottom-0 z-30 -ml-1.5 w-3 cursor-ew-resize"
                  style={{ left: s.end * pxPerSec }}
                >
                  <span className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-white/85 group-hover:bg-white" />
                </span>
              );
            });
          })()}
          <span
            onPointerDown={startClipTrim("in")}
            title="Trim clip start"
            className="absolute left-0 top-0 bottom-0 z-30 w-2 cursor-ew-resize bg-primary/50 hover:bg-primary"
          />
          <span
            onPointerDown={startClipTrim("out")}
            title="Trim clip end"
            className="absolute right-0 top-0 bottom-0 z-30 w-2 cursor-ew-resize bg-primary/50 hover:bg-primary"
          />
        </div>

        {/* Audio track: waveform + audio chips */}
        <div className="relative border-b" style={{ height: AUDIO_H }}>
          <span className="pointer-events-none absolute left-1 top-0.5 z-20 text-[9px] uppercase tracking-wider text-muted-foreground/50">Audio</span>
          <canvas ref={waveRef} className="pointer-events-none absolute inset-0" style={{ width, height: AUDIO_H }} />
          {edit.audio.map((a) => {
            const selected = selectedItem?.kind === "audio" && selectedItem.id === a.id;
            return (
            <div
              key={a.id}
              onPointerDown={selectAndDrag("audio", a.id, a.start, a.end)}
              className={`group absolute top-1 bottom-1 z-10 flex cursor-grab items-center overflow-hidden border border-foreground/30 bg-foreground/15 px-2 text-[10px] font-medium active:cursor-grabbing ${selected ? "ring-2 ring-foreground" : ""}`}
              style={{ left: a.start * pxPerSec, width: Math.max(20, (a.end - a.start) * pxPerSec) }}
            >
              <span onPointerDown={startTrim("audio", a.id, a.start, a.end)("start")} className="absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize bg-foreground/40 opacity-0 group-hover:opacity-100" />
              <span className="truncate">{a.label?.slice(0, 14) || a.kind}</span>
              <span onPointerDown={startTrim("audio", a.id, a.start, a.end)("end")} className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize bg-foreground/40 opacity-0 group-hover:opacity-100" />
            </div>
            );
          })}
        </div>

        {/* Selection shading */}
        {selection && (
          <div
            className="pointer-events-none absolute z-20 border-x-2 border-primary bg-primary/25"
            style={{ left: selection.start * pxPerSec, width: (selection.end - selection.start) * pxPerSec, top: 24, bottom: 0 }}
          />
        )}

        {/* Playhead */}
        <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-foreground" style={{ left: playhead * pxPerSec }}>
          <div className="absolute -top-1 -left-1.5 h-3 w-3 bg-foreground" />
        </div>
      </div>
    </div>
  );
}

function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative flex h-10 items-center border-b">
      <span className="pointer-events-none absolute left-1 z-10 text-[9px] uppercase tracking-wider text-muted-foreground/50">{label}</span>
      {children}
    </div>
  );
}

function Seg({
  left, width, className, children, draggable, onPointerDown, trim, top, height,
}: {
  left: number; width: number; className: string; children: React.ReactNode;
  draggable?: boolean; onPointerDown?: (e: React.PointerEvent) => void;
  trim?: (edge: "start" | "end") => (e: React.PointerEvent) => void;
  top?: number; height?: number;
}) {
  const positioned = top !== undefined;
  return (
    <div
      onPointerDown={onPointerDown}
      className={`group absolute ${positioned ? "" : "top-1 bottom-1"} flex items-center overflow-hidden border px-2 text-[10px] font-medium ${className} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left, width, ...(positioned ? { top, height } : null) }}
    >
      {trim && (
        <span onPointerDown={trim("start")} className="absolute left-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize bg-foreground/40 opacity-0 group-hover:opacity-100" />
      )}
      <span className="truncate">{children}</span>
      {trim && (
        <span onPointerDown={trim("end")} className="absolute right-0 top-0 bottom-0 z-10 w-1.5 cursor-ew-resize bg-foreground/40 opacity-0 group-hover:opacity-100" />
      )}
    </div>
  );
}
