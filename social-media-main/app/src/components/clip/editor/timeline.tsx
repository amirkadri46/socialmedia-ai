"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Blend, Film, Music, Type, Image as ImageIcon, Captions, Aperture } from "lucide-react";
import type { ClipEdit, TransitionMarker } from "@/lib/types";
import { allTransitions, editedDuration, editedToSource, transitionWindow } from "@/lib/clip/edit-timeline";

export type TimelineItemKind = "layout" | "transition" | "text" | "media" | "broll" | "audio" | "caption" | "background";
export type TimelineItem = { kind: TimelineItemKind; id: string };
export interface Selection { start: number; end: number }

export interface FilmstripMeta {
  frameCount: number;
  frameW: number;
  frameH: number;
  intervalSec: number;
  sourceDurationSec: number;
  sourceFps: number;
}

type Props = {
  jobId: string;
  edit: ClipEdit;
  playhead: number;
  pxPerSec: number;
  onSeek: (t: number) => void;
  onZoom: (dir: 1 | -1) => void;
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
  selection: Selection | null;
  onSelection: (sel: Selection | null) => void;
  selectedItems?: TimelineItem[];
  onSelectItems?: (items: TimelineItem[]) => void;
  selectedItem?: TimelineItem | null;
  onSelectItem?: (item: TimelineItem | null) => void;
  onMeta?: (meta: FilmstripMeta) => void;
};

type Timed = { id: string; start: number; end: number };
type Hit = TimelineItem & { start: number; end: number; top: number; bottom: number };

const TRACK = {
  ruler: 24,
  captions: 32,
  transitions: 28,
  framing: 34,
  video: 58,
  overlays: 30,
  background: 28,
  audio: 46,
};
const MIN_LEN = 0.05;

const LABELS: Record<TransitionMarker["type"], string> = {
  fadein: "Fade",
  fadeout: "Fade",
  crossfade: "Cross dissolve",
  crosszoom: "Cross zoom",
  zoomin: "Zoom in",
  zoomout: "Zoom out",
};

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
  selectedItems,
  onSelectItems,
  selectedItem,
  onSelectItem,
  onMeta,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const lastSelected = useRef<TimelineItem | null>(null);
  const duration = editedDuration(edit);
  const width = Math.max(240, duration * pxPerSec);
  const selected = useMemo(() => selectedItems ?? (selectedItem ? [selectedItem] : []), [selectedItems, selectedItem]);
  const selectedKeys = useMemo(() => new Set(selected.map(keyOf)), [selected]);
  const [film, setFilm] = useState<FilmstripMeta | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const spriteUrl = `/api/clip/${jobId}/filmstrip`;

  function commitSelection(items: TimelineItem[]) {
    onSelectItems?.(items);
    onSelectItem?.(items[0] ?? null);
    lastSelected.current = items[items.length - 1] ?? null;
  }

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
  }, [jobId, onMeta]);

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

  useEffect(() => {
    const cv = waveRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.ceil(width * dpr);
    cv.height = Math.ceil(TRACK.audio * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, TRACK.audio);
    if (!peaks?.length || !film) return;
    ctx.fillStyle = "rgba(148, 163, 184, .62)";
    const mid = TRACK.audio / 2;
    for (let x = 0; x < width; x += 2) {
      const srcT = editedToSource(edit, x / pxPerSec);
      const idx = Math.min(peaks.length - 1, Math.max(0, Math.floor((srcT / Math.max(1, film.sourceDurationSec)) * peaks.length)));
      const h = Math.max(1, peaks[idx] * (TRACK.audio - 6));
      ctx.fillRect(x, mid - h / 2, 1.5, h);
    }
  }, [edit, film, peaks, pxPerSec, width]);

  const overlayRows = packRows([
    ...edit.textOverlays.map((o) => ({ kind: "text" as const, id: o.id, start: o.start, end: o.end, label: o.text || "Text" })),
    ...edit.mediaOverlays.map((m) => ({ kind: "media" as const, id: m.id, start: m.start, end: m.end, label: m.kind })),
    ...edit.broll.map((b) => ({ kind: "broll" as const, id: b.id, start: b.start, end: b.end, label: "B-roll" })),
  ]);
  const overlayH = Math.max(1, overlayRows.rowCount) * TRACK.overlays + 8;
  const transitionRows = packRows(allTransitions(edit).map((t) => ({ kind: "transition" as const, id: t.id, start: transitionWindow(t).start, end: transitionWindow(t).end, label: LABELS[t.type], marker: t })));
  const transitionH = Math.max(1, transitionRows.rowCount) * TRACK.transitions + 6;

  const tops = {
    captions: TRACK.ruler,
    transitions: TRACK.ruler + TRACK.captions,
    framing: TRACK.ruler + TRACK.captions + transitionH,
    video: TRACK.ruler + TRACK.captions + transitionH + TRACK.framing,
    overlays: TRACK.ruler + TRACK.captions + transitionH + TRACK.framing + TRACK.video,
    background: TRACK.ruler + TRACK.captions + transitionH + TRACK.framing + TRACK.video + overlayH,
    audio: TRACK.ruler + TRACK.captions + transitionH + TRACK.framing + TRACK.video + overlayH + TRACK.background,
  };
  const totalH = tops.audio + TRACK.audio;

  const hits: Hit[] = useMemo(() => {
    const out: Hit[] = [];
    if (edit.caption.enabled) out.push({ kind: "caption", id: "caption", start: 0, end: duration, top: tops.captions, bottom: tops.captions + TRACK.captions });
    if (edit.blurBg?.enabled) out.push({ kind: "background", id: "background", start: 0, end: duration, top: tops.background, bottom: tops.background + TRACK.background });
    for (const s of edit.layout) out.push({ kind: "layout", id: s.id, start: s.start, end: s.end, top: tops.video, bottom: tops.video + TRACK.video });
    for (const r of transitionRows.items) out.push({ kind: "transition", id: r.id, start: r.start, end: r.end, top: tops.transitions + r.row * TRACK.transitions, bottom: tops.transitions + (r.row + 1) * TRACK.transitions });
    for (const r of overlayRows.items) out.push({ kind: r.kind, id: r.id, start: r.start, end: r.end, top: tops.overlays + r.row * TRACK.overlays, bottom: tops.overlays + (r.row + 1) * TRACK.overlays });
    for (const a of edit.audio) out.push({ kind: "audio", id: a.id, start: a.start, end: a.end, top: tops.audio, bottom: tops.audio + TRACK.audio });
    return out;
  }, [duration, edit, overlayRows.items, transitionRows.items, tops.audio, tops.background, tops.captions, tops.overlays, tops.transitions, tops.video]);

  const snapPoints = useMemo(() => {
    const pts = [0, duration, playhead];
    edit.layout.forEach((s) => pts.push(s.start, s.end));
    edit.textOverlays.forEach((s) => pts.push(s.start, s.end));
    edit.mediaOverlays.forEach((s) => pts.push(s.start, s.end));
    edit.broll.forEach((s) => pts.push(s.start, s.end));
    edit.audio.forEach((s) => pts.push(s.start, s.end));
    edit.transitions.forEach((s) => pts.push(s.atTime));
    return pts;
  }, [duration, edit, playhead]);

  function timeAt(clientX: number) {
    const rect = innerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp((clientX - rect.left) / pxPerSec, 0, duration);
  }

  function pointAt(e: PointerEvent | React.PointerEvent) {
    const rect = innerRef.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 };
  }

  function snap(t: number) {
    const limit = 8 / pxPerSec;
    let best = t;
    let dist = limit;
    for (const p of snapPoints) {
      const d = Math.abs(p - t);
      if (d < dist) { dist = d; best = p; }
    }
    return clamp(best, 0, duration);
  }

  function select(item: TimelineItem, e: React.PointerEvent | React.MouseEvent) {
    const flat = hits.map(({ kind, id }) => ({ kind, id }));
    let next = [item];
    if (e.shiftKey && lastSelected.current) {
      const a = flat.findIndex((x) => keyOf(x) === keyOf(lastSelected.current!));
      const b = flat.findIndex((x) => keyOf(x) === keyOf(item));
      if (a >= 0 && b >= 0) next = flat.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else if (e.ctrlKey || e.metaKey) {
      next = selectedKeys.has(keyOf(item)) ? selected.filter((x) => keyOf(x) !== keyOf(item)) : [...selected, item];
    }
    commitSelection(next);
  }

  function startScrub(e: React.PointerEvent) {
    e.preventDefault();
    onSeek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => onSeek(timeAt(ev.clientX));
    const up = () => off(move, up);
    on(move, up);
  }

  function startMarquee(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = pointAt(e);
    const t0 = timeAt(e.clientX);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = pointAt(ev);
      moved = moved || Math.abs(p.x - start.x) > 3 || Math.abs(p.y - start.y) > 3;
      setMarquee({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
      const l = Math.min(start.x, p.x) / pxPerSec;
      const r = Math.max(start.x, p.x) / pxPerSec;
      const top = Math.min(start.y, p.y);
      const bottom = Math.max(start.y, p.y);
      onSelection({ start: clamp(l, 0, duration), end: clamp(r, 0, duration) });
      commitSelection(hits.filter((h) => h.end >= l && h.start <= r && h.bottom >= top && h.top <= bottom).map(({ kind, id }) => ({ kind, id })));
    };
    const up = () => {
      off(move, up);
      setMarquee(null);
      if (!moved) {
        onSelection(null);
        commitSelection([]);
        onSeek(t0);
      }
    };
    on(move, up);
  }

  function updateTimed(kind: TimelineItemKind, id: string, fn: (x: Timed) => void) {
    onUpdate((d) => {
      const list =
        kind === "text" ? d.textOverlays :
        kind === "media" ? d.mediaOverlays :
        kind === "broll" ? d.broll :
        kind === "audio" ? d.audio :
        [];
      const item = (list as Timed[]).find((x) => x.id === id);
      if (item) fn(item);
    });
  }

  function startMove(item: TimelineItem, start: number, end: number) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      select(item, e);
      const sx = e.clientX;
      const len = end - start;
      const move = (ev: PointerEvent) => {
        const ns = snap(start + (ev.clientX - sx) / pxPerSec);
        if (item.kind === "transition") {
          // Snap by center so the marker lands naturally on cut boundaries
          const newCenter = snap((start + end) / 2 + (ev.clientX - sx) / pxPerSec);
          onUpdate((d) => { const t = d.transitions.find((x) => x.id === item.id); if (t) t.atTime = len >= duration ? 0 : clamp(newCenter - len / 2, 0, duration - len); });
        } else if (item.kind === "layout") {
          slideLayout(item.id, ns, len);
        } else {
          updateTimed(item.kind, item.id, (x) => { x.start = clamp(ns, 0, duration - len); x.end = x.start + len; });
        }
      };
      const up = () => off(move, up);
      on(move, up);
    };
  }

  function slideLayout(id: string, newStart: number, len: number) {
    onUpdate((d) => {
      const sorted = [...d.layout].sort((a, b) => a.start - b.start);
      const i = sorted.findIndex((s) => s.id === id);
      if (i < 0) return;
      const prev = sorted[i - 1], seg = sorted[i], next = sorted[i + 1];
      const min = prev ? prev.start + MIN_LEN : 0;
      const max = next ? next.end - len - MIN_LEN : duration - len;
      const ns = clamp(newStart, min, max);
      const ne = ns + len;
      if (prev) prev.end = ns;
      seg.start = ns; seg.end = ne;
      if (next) next.start = ne;
      d.layout = sorted;
    });
  }

  function startTrim(item: TimelineItem, edge: "start" | "end", start: number, end: number) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      select(item, e);
      const sx = e.clientX;
      const move = (ev: PointerEvent) => {
        const t = snap((edge === "start" ? start : end) + (ev.clientX - sx) / pxPerSec);
        if (item.kind === "layout") trimLayout(item.id, edge, t);
        else if (item.kind === "transition") {
          const center = (start + end) / 2;
          onUpdate((d) => { const tr = d.transitions.find((x) => x.id === item.id); if (tr) tr.durationSec = Math.max(MIN_LEN, Math.abs(t - center) * 2); });
        } else {
          updateTimed(item.kind, item.id, (x) => {
            if (edge === "start") x.start = clamp(t, 0, x.end - MIN_LEN);
            else x.end = clamp(t, x.start + MIN_LEN, duration);
          });
        }
      };
      const up = () => off(move, up);
      on(move, up);
    };
  }

  function trimLayout(id: string, edge: "start" | "end", t: number) {
    onUpdate((d) => {
      const sorted = [...d.layout].sort((a, b) => a.start - b.start);
      const i = sorted.findIndex((s) => s.id === id);
      const seg = sorted[i];
      if (!seg) return;
      if (edge === "start") {
        const prev = sorted[i - 1];
        if (prev) { const nt = clamp(t, prev.start + MIN_LEN, seg.end - MIN_LEN); prev.end = nt; seg.start = nt; }
        else d.sourceInSec = Math.min(d.sourceOutSec - MIN_LEN, Math.max(0, d.sourceInSec + (t - seg.start)));
      } else {
        const next = sorted[i + 1];
        if (next) { const nt = clamp(t, seg.start + MIN_LEN, next.end - MIN_LEN); seg.end = nt; next.start = nt; }
        else d.sourceOutSec = Math.max(d.sourceInSec + MIN_LEN, d.sourceOutSec + (t - seg.end));
      }
      d.layout = sorted;
    });
  }

  const ticks = [];
  const step = pxPerSec < 30 ? 10 : pxPerSec < 70 ? 5 : 1;
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);

  const cols = [];
  if (film?.intervalSec) {
    const colW = Math.max(12, film.intervalSec * pxPerSec);
    for (let left = 0; left < width; left += colW) {
      const srcT = editedToSource(edit, left / pxPerSec);
      const frameIdx = clamp(Math.round(srcT / film.intervalSec), 0, film.frameCount - 1);
      cols.push({ left, colW, frameIdx });
    }
  }

  return (
    <div ref={scrollRef} className="relative overflow-auto bg-background" style={{ maxHeight: 360 }}>
      <div ref={innerRef} onPointerDown={startMarquee} className="relative select-none" style={{ width, height: totalH }}>
        <div className="absolute left-0 right-0 top-0 h-6 cursor-ew-resize border-b bg-background" onPointerDown={startScrub}>
          {ticks.map((t) => <span key={t} className="absolute top-1 text-[10px] text-muted-foreground" style={{ left: t * pxPerSec }}>{fmt(t)}</span>)}
        </div>

        <Track top={tops.captions} h={TRACK.captions} label="Captions">
          {edit.caption.enabled && <Block item={{ kind: "caption", id: "caption" }} selected={selectedKeys.has("caption:caption")} left={0} width={duration * pxPerSec} onDown={(e) => { e.stopPropagation(); select({ kind: "caption", id: "caption" }, e); }} className="border-foreground/35 bg-foreground/15"><Captions className="h-3 w-3" /> {edit.caption.preset}</Block>}
        </Track>

        <Track top={tops.transitions} h={transitionH} label="Transitions">
          {transitionRows.items.map((r) => {
            const item = { kind: "transition" as const, id: r.id };
            const isAuto = r.id.startsWith("auto-");
            return (
              <Block
                key={r.id}
                item={item}
                selected={selectedKeys.has(keyOf(item))}
                left={r.start * pxPerSec}
                width={Math.max(48, (r.end - r.start) * pxPerSec)}
                top={r.row * TRACK.transitions + 4}
                h={20}
                onDown={isAuto ? (e) => { e.stopPropagation(); onSeek((r.start + r.end) / 2); } : startMove(item, r.start, r.end)}
                trim={!isAuto ? startTrim(item, "start", r.start, r.end) : undefined}
                trimEnd={!isAuto ? startTrim(item, "end", r.start, r.end) : undefined}
                className={isAuto ? "border-muted-foreground/20 bg-muted text-muted-foreground" : "border-primary/70 bg-primary/30"}
              ><Blend className="h-3 w-3" /> {r.label}</Block>
            );
          })}
        </Track>

        <Track top={tops.framing} h={TRACK.framing} label="Framing">
          {edit.layout.map((s) => {
            const item = { kind: "layout" as const, id: s.id };
            return <Block key={s.id} item={item} selected={selectedKeys.has(keyOf(item))} left={s.start * pxPerSec} width={(s.end - s.start) * pxPerSec} onDown={(e) => { select(item, e); onSeek(s.start); }} className={s.mode === "fill" ? "border-emerald-400/70 bg-emerald-500/25" : "border-sky-400/70 bg-sky-500/25"}><Film className="h-3 w-3" /> {s.kind && s.kind !== "single" ? s.kind : s.mode}</Block>;
          })}
        </Track>

        <Track top={tops.video} h={TRACK.video} label="Video" className="bg-muted/30">
          {film && cols.map((c, i) => (
            <div key={i} className="pointer-events-none absolute top-0 bottom-0" style={{ left: c.left, width: c.colW + 1, backgroundImage: `url(${spriteUrl})`, backgroundRepeat: "no-repeat", backgroundSize: `${film.frameCount * c.colW}px ${TRACK.video}px`, backgroundPosition: `${-c.frameIdx * c.colW}px 0` }} />
          ))}
          {edit.layout.map((s) => {
            const item = { kind: "layout" as const, id: s.id };
            const sel = selectedKeys.has(keyOf(item));
            return (
              <div key={s.id} onPointerDown={startMove(item, s.start, s.end)} className={`absolute top-0 bottom-0 z-20 border ${sel ? "border-primary bg-primary/10" : "border-transparent hover:border-foreground/50"}`} style={{ left: s.start * pxPerSec, width: Math.max(8, (s.end - s.start) * pxPerSec) }}>
                {sel && <>
                  <Handle side="left" onPointerDown={startTrim(item, "start", s.start, s.end)} />
                  <Handle side="right" onPointerDown={startTrim(item, "end", s.start, s.end)} />
                </>}
              </div>
            );
          })}
          {[...edit.layout].sort((a, b) => a.start - b.start).slice(1).map((s) => <span key={s.id} className="absolute top-0 bottom-0 z-30 w-px bg-white/90" style={{ left: s.start * pxPerSec }} />)}
        </Track>

        <Track top={tops.overlays} h={overlayH} label="Overlays">
          {overlayRows.items.map((r) => {
            const item = { kind: r.kind, id: r.id };
            const Icon = r.kind === "text" ? Type : r.kind === "media" ? ImageIcon : Film;
            return <Block key={keyOf(item)} item={item} selected={selectedKeys.has(keyOf(item))} left={r.start * pxPerSec} width={(r.end - r.start) * pxPerSec} top={r.row * TRACK.overlays + 4} h={22} onDown={startMove(item, r.start, r.end)} trim={startTrim(item, "start", r.start, r.end)} trimEnd={startTrim(item, "end", r.start, r.end)} className="border-violet-400/60 bg-violet-500/25"><Icon className="h-3 w-3" /> {r.label}</Block>;
          })}
        </Track>

        <Track top={tops.background} h={TRACK.background} label="Background">
          {edit.blurBg?.enabled && <Block item={{ kind: "background", id: "background" }} selected={selectedKeys.has("background:background")} left={0} width={duration * pxPerSec} onDown={(e) => { e.stopPropagation(); select({ kind: "background", id: "background" }, e); }} className="border-amber-400/60 bg-amber-500/25"><Aperture className="h-3 w-3" /> Blur background</Block>}
        </Track>

        <Track top={tops.audio} h={TRACK.audio} label="Audio">
          <canvas ref={waveRef} className="pointer-events-none absolute inset-0" style={{ width, height: TRACK.audio }} />
          {edit.audio.map((a) => {
            const item = { kind: "audio" as const, id: a.id };
            return <Block key={a.id} item={item} selected={selectedKeys.has(keyOf(item))} left={a.start * pxPerSec} width={(a.end - a.start) * pxPerSec} onDown={startMove(item, a.start, a.end)} trim={startTrim(item, "start", a.start, a.end)} trimEnd={startTrim(item, "end", a.start, a.end)} className="border-foreground/30 bg-foreground/15"><Music className="h-3 w-3" /> {a.label || a.kind}</Block>;
          })}
        </Track>

        {selection && <div className="pointer-events-none absolute z-40 border-x-2 border-primary bg-primary/20" style={{ left: selection.start * pxPerSec, width: Math.max(1, (selection.end - selection.start) * pxPerSec), top: TRACK.ruler, bottom: 0 }} />}
        {marquee && <div className="pointer-events-none absolute z-50 border border-primary bg-primary/20" style={{ left: Math.min(marquee.x1, marquee.x2), top: Math.min(marquee.y1, marquee.y2), width: Math.abs(marquee.x2 - marquee.x1), height: Math.abs(marquee.y2 - marquee.y1) }} />}
        <div className="pointer-events-none absolute top-0 bottom-0 z-50 w-px bg-foreground" style={{ left: playhead * pxPerSec }}><div className="absolute -top-1 -left-1.5 h-3 w-3 bg-foreground" /></div>
      </div>
    </div>
  );
}

function Track({ top, h, label, children, className = "" }: { top: number; h: number; label: string; children: React.ReactNode; className?: string }) {
  return <div className={`absolute left-0 right-0 border-b ${className}`} style={{ top, height: h }}><span className="pointer-events-none absolute left-1 top-1 z-30 text-[9px] uppercase tracking-wider text-muted-foreground/60">{label}</span>{children}</div>;
}

function Block({ selected, left, width, top = 4, h, className, children, onDown, trim, trimEnd }: {
  item: TimelineItem;
  selected: boolean;
  left: number;
  width: number;
  top?: number;
  h?: number;
  className: string;
  children: React.ReactNode;
  onDown: (e: React.PointerEvent) => void;
  trim?: (e: React.PointerEvent) => void;
  trimEnd?: (e: React.PointerEvent) => void;
}) {
  return (
    <div onPointerDown={onDown} className={`group absolute z-20 flex cursor-grab items-center gap-1 overflow-hidden border px-2 text-[10px] font-semibold capitalize active:cursor-grabbing ${className} ${selected ? "ring-2 ring-foreground ring-offset-1 ring-offset-background" : ""}`} style={{ left, width: Math.max(16, width), top, height: h ?? "calc(100% - 8px)" }}>
      {trim && <Handle side="left" onPointerDown={trim} subtle />}
      <span className="flex min-w-0 items-center gap-1 truncate">{children}</span>
      {trimEnd && <Handle side="right" onPointerDown={trimEnd} subtle />}
    </div>
  );
}

function Handle({ side, onPointerDown, subtle }: { side: "left" | "right"; onPointerDown: (e: React.PointerEvent) => void; subtle?: boolean }) {
  return <span onPointerDown={onPointerDown} className={`absolute top-0 bottom-0 z-30 w-2 cursor-ew-resize ${side}-0 ${subtle ? "bg-foreground/40 opacity-0 group-hover:opacity-100" : "bg-primary"}`} />;
}

function packRows<T extends { start: number; end: number }>(items: T[]) {
  const rowEnds: number[] = [];
  const packed = [...items].sort((a, b) => a.start - b.start).map((it) => {
    let row = rowEnds.findIndex((end) => it.start >= end - 1e-3);
    if (row === -1) { row = rowEnds.length; rowEnds.push(it.end); }
    else rowEnds[row] = it.end;
    return { ...it, row };
  });
  return { items: packed, rowCount: Math.max(1, rowEnds.length) };
}

function keyOf(item: TimelineItem) {
  return `${item.kind}:${item.id}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function on(move: (e: PointerEvent) => void, up: () => void) {
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function off(move: (e: PointerEvent) => void, up: () => void) {
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", up);
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
