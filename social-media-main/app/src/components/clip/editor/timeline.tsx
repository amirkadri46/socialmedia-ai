"use client";

import { useEffect, useRef } from "react";
import type { ClipEdit } from "@/lib/types";
import { editedDuration } from "@/lib/clip/edit-timeline";

type MovableKind = "text" | "media" | "broll" | "audio";

export function Timeline({
  edit,
  playhead,
  pxPerSec,
  onSeek,
  onZoom,
  onUpdate,
}: {
  edit: ClipEdit;
  playhead: number;
  pxPerSec: number;
  onSeek: (t: number) => void;
  onZoom: (dir: 1 | -1) => void;
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const duration = editedDuration(edit);
  const width = Math.max(duration * pxPerSec, 200);

  // Ctrl/⌘ + wheel = expand/shrink (zoom). Plain wheel scrolls the timeline natively.
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

  function timeAtClientX(clientX: number): number {
    const el = innerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(duration, Math.max(0, (clientX - rect.left) / pxPerSec));
  }

  // Scrub: drag anywhere on the empty timeline to move the playhead.
  function startScrub(e: React.PointerEvent) {
    onSeek(timeAtClientX(e.clientX));
    const move = (ev: PointerEvent) => onSeek(timeAtClientX(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function listFor(d: ClipEdit, kind: MovableKind) {
    return (kind === "text" ? d.textOverlays : kind === "media" ? d.mediaOverlays : kind === "broll" ? d.broll : d.audio) as { id: string; start: number; end: number }[];
  }

  // Trim a segment edge (resize start or end) without moving the other edge.
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

  // Drag a segment horizontally to shift its time window.
  function startSegDrag(kind: MovableKind, id: string, segStart: number, segEnd: number) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const len = segEnd - segStart;
      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / pxPerSec;
        const ns = Math.min(duration - len, Math.max(0, segStart + delta));
        onUpdate((d) => {
          const list =
            kind === "text" ? d.textOverlays :
            kind === "media" ? d.mediaOverlays :
            kind === "broll" ? d.broll : d.audio;
          const seg = (list as { id: string; start: number; end: number }[]).find((x) => x.id === id);
          if (seg) { seg.start = ns; seg.end = ns + len; }
        });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  const ticks: number[] = [];
  const step = pxPerSec < 25 ? 10 : 5;
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  return (
    <div ref={scrollRef} className="relative overflow-x-auto overflow-y-hidden">
      <div ref={innerRef} style={{ width }} className="relative select-none">
        {/* Ruler (scrub) */}
        <div className="relative h-6 cursor-ew-resize border-b" onPointerDown={startScrub}>
          {ticks.map((t) => (
            <span key={t} className="pointer-events-none absolute top-1 text-[10px] text-muted-foreground" style={{ left: t * pxPerSec }}>
              {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
            </span>
          ))}
        </div>

        {/* Removed-range shading */}
        <div className="pointer-events-none absolute inset-x-0" style={{ top: 24, bottom: 0 }}>
          {/* (visual only; removed ranges already collapsed in edited time) */}
        </div>

        <Lane label="Video" onScrub={startScrub}>
          {edit.layout.map((s) => (
            <Seg key={s.id} left={s.start * pxPerSec} width={(s.end - s.start) * pxPerSec}
              className={s.mode === "fill" ? "bg-foreground/25 border-foreground/40" : "bg-foreground/10 border-foreground/30"}>
              {s.mode === "fill" ? (s.crop ? "Fill ·cropped" : "Fill") : "Fit"}
            </Seg>
          ))}
        </Lane>

        <Lane label="Captions" onScrub={startScrub}>
          {edit.caption.enabled && (
            <Seg left={0} width={duration * pxPerSec} className="bg-foreground/20 border-foreground/35">{edit.caption.preset}</Seg>
          )}
        </Lane>

        <Lane label="Overlays" onScrub={startScrub}>
          {edit.textOverlays.map((o) => (
            <Seg key={o.id} draggable left={o.start * pxPerSec} width={Math.max(20, (o.end - o.start) * pxPerSec)}
              className="bg-foreground/15 border-foreground/30"
              onPointerDown={startSegDrag("text", o.id, o.start, o.end)}
              trim={startTrim("text", o.id, o.start, o.end)}>{o.text.slice(0, 14)}</Seg>
          ))}
          {edit.mediaOverlays.map((m) => (
            <Seg key={m.id} draggable left={m.start * pxPerSec} width={Math.max(20, (m.end - m.start) * pxPerSec)}
              className="bg-foreground/15 border-foreground/30"
              onPointerDown={startSegDrag("media", m.id, m.start, m.end)}
              trim={startTrim("media", m.id, m.start, m.end)}>{m.kind}</Seg>
          ))}
          {edit.broll.map((b) => (
            <Seg key={b.id} draggable left={b.start * pxPerSec} width={Math.max(20, (b.end - b.start) * pxPerSec)}
              className="bg-foreground/15 border-foreground/30"
              onPointerDown={startSegDrag("broll", b.id, b.start, b.end)}
              trim={startTrim("broll", b.id, b.start, b.end)}>B-roll</Seg>
          ))}
        </Lane>

        <Lane label="Audio" onScrub={startScrub}>
          {edit.audio.map((a) => (
            <Seg key={a.id} draggable left={a.start * pxPerSec} width={Math.max(20, (a.end - a.start) * pxPerSec)}
              className="bg-foreground/15 border-foreground/30"
              onPointerDown={startSegDrag("audio", a.id, a.start, a.end)}
              trim={startTrim("audio", a.id, a.start, a.end)}>{a.label?.slice(0, 14) || a.kind}</Seg>
          ))}
        </Lane>

        {/* Playhead */}
        <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-foreground" style={{ left: playhead * pxPerSec }}>
          <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-foreground" />
        </div>
      </div>
    </div>
  );
}

function Lane({ label, children, onScrub }: { label: string; children: React.ReactNode; onScrub: (e: React.PointerEvent) => void }) {
  return (
    <div className="relative flex h-10 items-center border-b" onPointerDown={onScrub}>
      <span className="pointer-events-none absolute left-1 z-10 text-[9px] uppercase tracking-wider text-muted-foreground/50">{label}</span>
      {children}
    </div>
  );
}

function Seg({
  left, width, className, children, draggable, onPointerDown, trim,
}: {
  left: number; width: number; className: string; children: React.ReactNode;
  draggable?: boolean; onPointerDown?: (e: React.PointerEvent) => void;
  trim?: (edge: "start" | "end") => (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={`group absolute top-1 bottom-1 flex items-center overflow-hidden rounded-md border px-2 text-[10px] font-medium ${className} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left, width }}
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
