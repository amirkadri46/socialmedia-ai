"use client";

import { useEffect, useMemo, useRef, useState, type RefObject, type CSSProperties } from "react";
import type { ClipEdit, CropRect, LayoutKind, VideoFrame, Word } from "@/lib/types";
import { allTransitions, editedToWindow, layoutAt, windowWords } from "@/lib/clip/edit-timeline";
import {
  aspectRatioValue, resolveFrame,
  slotAspect, splitSlots,
} from "@/lib/clip/layout-geom";
import { CaptionLayer } from "./caption-render";

/** CSS that positions a <video> inside a clipped box to show only the kept source region. */
function cropToCss(crop: CropRect | undefined): CSSProperties {
  return crop && crop.w > 0 && crop.h > 0
    ? { position: "absolute", width: `${100 / crop.w}%`, height: `${100 / crop.h}%`, left: `${-(crop.x / crop.w) * 100}%`, top: `${-(crop.y / crop.h) * 100}%`, maxWidth: "none", maxHeight: "none", objectFit: "fill" }
    : { position: "absolute", left: 0, top: 0, width: "100%", height: "100%", maxWidth: "none", maxHeight: "none", objectFit: "fill" };
}

/**
 * Live preview (video-as-object model): the box is the final output canvas; the base
 * <video> is a movable, aspect-locked-scalable layer placed inside it per the active
 * LayoutSegment's `frame` (Fill = overflow/cropped, Fit = inside with bars). The crop
 * region (set in the Crop modal / aspect picker) selects which part of the source the
 * box shows. Captions + text/media overlays sit on top in canvas coords. Pure render of `edit`.
 */
export function PreviewCanvas({
  jobId,
  edit,
  words,
  playhead,
  videoRef,
  onUpdate,
  onOpenCrop,
  selectedTextId,
  onSelectText,
  sourceVideoUrl,
}: {
  jobId: string;
  edit: ClipEdit;
  words: Word[];
  playhead: number; // edited-timeline seconds
  videoRef: RefObject<HTMLVideoElement | null>;
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
  onOpenCrop?: () => void;
  selectedTextId?: string | null;
  onSelectText?: (id: string | null) => void;
  sourceVideoUrl?: string | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const windowT = editedToWindow(edit, playhead);
  const seg = layoutAt(edit, playhead);
  const canvasAR = aspectRatioValue(edit.aspectRatio);
  const [srcDims, setSrcDims] = useState({ w: 16, h: 9 });

  // Source-time words rebased to window coords, with per-word highlight colors + edits (3A).
  const windowedWords = windowWords(edit, words);

  // ── Transitions ────────────────────────────────────────────────────────────────────
  // Manual markers + auto-transitions (same pure helper the export uses), then the one
  // active at the current playhead with its phase ("out" = into the cut, "in" = out of it)
  // and progress p (0→1). Computed synchronously in render so it's frame-accurate with the
  // playhead (no useEffect lag). Each marker's window is [atTime - d/2, atTime + d/2].
  const allT = useMemo(() => allTransitions(edit), [edit]);
  // Each transition has a window keyed off its boundary `atTime` and resolves to the NORMAL
  // state at the end (no symmetric pulse): directional effects (fadein/zoomin/zoomout) play
  // [atTime, atTime+d] and land on normal; fadeout dips out over [atTime-d, atTime]; the
  // "cross" blends stay centered [atTime-d/2, atTime+d/2]. `p` is 0→1 across the window.
  const activeTransition = useMemo(() => {
    for (const t of allT) {
      const d = Math.max(0.001, t.durationSec);
      let start: number, end: number;
      if (t.type === "fadeout") { start = t.atTime - d; end = t.atTime; }
      else if (t.type === "crossfade" || t.type === "crosszoom") { start = t.atTime - d / 2; end = t.atTime + d / 2; }
      else { start = t.atTime; end = t.atTime + d; } // fadein, zoomin, zoomout
      if (playhead >= start && playhead <= end) {
        const p = Math.min(1, Math.max(0, (playhead - start) / (end - start)));
        return { type: t.type, p };
      }
    }
    return null;
  }, [allT, playhead]);

  // CSS (transform + opacity) for the active transition, applied to the video box. Directional
  // effects end at scale 1 / opacity 1 (normal); zoom is a pure scale with NO fade.
  const transitionStyle: CSSProperties = useMemo(() => {
    if (!activeTransition) return {};
    const { type, p } = activeTransition;
    let scale = 1, opacity = 1;
    switch (type) {
      case "fadein": opacity = p; break;        // black → normal
      case "fadeout": opacity = 1 - p; break;   // normal → black
      case "zoomin": scale = 1.3 - p * 0.3; break;  // punch-in → normal (no fade)
      case "zoomout": scale = 0.7 + p * 0.3; break; // pull-out → normal (no fade)
      case "crossfade": opacity = p < 0.5 ? 1 - p : p; break; // dissolve dip at the cut
      case "crosszoom": {
        const e = p < 0.5 ? p : 1 - p; // 0→0.5→0
        scale = 1 + e * 0.4;
        opacity = p < 0.5 ? 1 - p : p;
        break;
      }
    }
    return { transform: `scale(${scale})`, opacity, transition: "none", willChange: "transform, opacity", transformOrigin: "center" };
  }, [activeTransition]);

  // Live video-box placement (move/scale). Keep a local draft during a drag so we commit
  // to undo history only once on pointer-up.
  const [draftFrame, setDraftFrame] = useState<VideoFrame | null>(null);
  useEffect(() => { setDraftFrame(null); }, [seg?.id]); // reset when the active segment changes
  const frame = draftFrame ?? resolveFrame(seg, srcDims.w, srcDims.h, canvasAR);

  function commitFrame(f: VideoFrame) {
    const id = seg?.id;
    if (!id) return;
    onUpdate((d) => { const t = d.layout.find((s) => s.id === id); if (t) t.frame = f; });
  }

  // Magnetic alignment guides shown while dragging the video box (Figma/Canva-style).
  const [snap, setSnap] = useState<{ x: "left" | "center" | "right" | null; y: "top" | "center" | "bottom" | null } | null>(null);
  const SNAP_PX = 14; // magnetic threshold

  // Drag the video box (move) with magnetic edge/center snapping and orientation-locked axis.
  function startMove(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const sx = e.clientX, sy = e.clientY, f0 = frame;
    const eps = 1e-3;
    // Axis lock: a horizontal video overflows the canvas on X (pan left/right only); a
    // vertical video overflows on Y (pan up/down only). When the whole video sits inside
    // the canvas (Fit), allow both axes so it can still be snapped freely.
    const overflowX = f0.w > 1 + eps;
    const overflowY = f0.h > 1 + eps;
    const allowX = overflowX || !overflowY;
    const allowY = overflowY || !overflowX;
    const thX = SNAP_PX / box.width;
    const thY = SNAP_PX / box.height;
    // Snap targets: video edges flush to the canvas edges, or the video centered.
    const targetsX: [("left" | "center" | "right"), number][] = [["left", 0], ["center", (1 - f0.w) / 2], ["right", 1 - f0.w]];
    const targetsY: [("top" | "center" | "bottom"), number][] = [["top", 0], ["center", (1 - f0.h) / 2], ["bottom", 1 - f0.h]];
    let latest = f0;
    const move = (ev: PointerEvent) => {
      let nx = allowX ? f0.x + (ev.clientX - sx) / box.width : f0.x;
      let ny = allowY ? f0.y + (ev.clientY - sy) / box.height : f0.y;
      let gx: "left" | "center" | "right" | null = null;
      let gy: "top" | "center" | "bottom" | null = null;
      if (allowX) for (const [k, t] of targetsX) if (Math.abs(nx - t) <= thX) { nx = t; gx = k; break; }
      if (allowY) for (const [k, t] of targetsY) if (Math.abs(ny - t) <= thY) { ny = t; gy = k; break; }
      latest = { ...f0, x: nx, y: ny };
      setDraftFrame(latest);
      setSnap({ x: gx, y: gy });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commitFrame(latest);
      setSnap(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // Aspect-locked corner scale (opposite corner stays put).
  function startResize(cornerX: 0 | 1, cornerY: 0 | 1) {
    return (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const f0 = frame;
      const fixedX = f0.x + (1 - cornerX) * f0.w;
      const fixedY = f0.y + (1 - cornerY) * f0.h;
      const ratioWH = f0.h > 0 ? f0.w / f0.h : 1; // canvas-normalized aspect to preserve
      let latest = f0;
      const move = (ev: PointerEvent) => {
        const px = (ev.clientX - box.left) / box.width;
        const py = (ev.clientY - box.top) / box.height;
        let w = Math.abs(px - fixedX);
        const wByH = Math.abs(py - fixedY) * ratioWH;
        if (wByH > w) w = wByH; // drive by whichever axis the cursor pulls further
        w = Math.min(4, Math.max(0.05, w));
        const h = w / ratioWH;
        const x = cornerX === 1 ? fixedX : fixedX - w;
        const y = cornerY === 1 ? fixedY : fixedY - h;
        latest = { x, y, w, h };
        setDraftFrame(latest);
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); commitFrame(latest); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };
  }

  // Reset draft when an external caller changes the segment's mode (e.g., shell toolbar).
  useEffect(() => { setDraftFrame(null); }, [seg?.mode]);

  // Crop CSS that makes the box show only the kept source region.
  const videoInBox = cropToCss(seg?.crop);

  // ── Multiple-speaker layouts (3D) ──────────────────────────────────────────────────
  const kind: LayoutKind = seg?.kind ?? "single";
  const isMulti = kind !== "single" && (seg?.panes?.length ?? 0) >= 2;
  const slots = splitSlots(kind);
  const panes = seg?.panes;
  const multiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selPane, setSelPane] = useState<number | null>(null);
  const [draftPane, setDraftPane] = useState<{ i: number; crop: CropRect } | null>(null);
  useEffect(() => { setSelPane(null); setDraftPane(null); }, [seg?.id]);

  // Live pane crops (including the in-progress drag), read by the canvas loop each frame.
  const livePanes = (panes ?? []).map((p, i) => (draftPane?.i === i ? draftPane.crop : p.crop));
  const livePanesRef = useRef(livePanes);
  livePanesRef.current = livePanes;

  // Smooth split-screen preview: composite ONE decoded <video> into N slots on a <canvas>
  // (one decode, perfectly synced) rather than N independent <video> elements (which stutter).
  // Mirrors the export's split→crop→scale→overlay exactly.
  useEffect(() => {
    if (!isMulti) return;
    const canvas = multiCanvasRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !video || !ctx) return;
    let raf = 0;
    const draw = () => {
      const box = boxRef.current;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (box && vw && vh) {
        const cw = box.clientWidth, ch = box.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
        if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, ch);
        const ps = livePanesRef.current;
        for (let i = 0; i < Math.min(slots.length, ps.length); i++) {
          const c = ps[i], s = slots[i];
          if (!c) continue;
          try { ctx.drawImage(video, c.x * vw, c.y * vh, c.w * vw, c.h * vh, s.x * cw, s.y * ch, s.w * cw, s.h * ch); } catch { /* frame not ready */ }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMulti, kind, videoRef]);

  // Deselect pane when layout kind changes (e.g., from the shell toolbar).
  useEffect(() => { setSelPane(null); }, [kind]);

  // ── Auto blurred background (Fit) ────────────────────────────────────────────────────
  // When the base video doesn't fill the canvas (bars), fill the empty area with a strongly
  // blurred, cover-scaled copy of the SAME source frame. Reuses the ONE decoded <video>
  // (drawn each rAF onto a canvas behind the box) — no second decode, perfectly in sync.
  const blurBg = edit.blurBg;
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const blurOn = !!blurBg?.enabled && !isMulti && (frame.w < 0.999 || frame.h < 0.999);
  const blurStateRef = useRef<{ on: boolean; crop?: CropRect; blur: number; scale: number; brightness: number; opacity: number }>({
    on: false, blur: 60, scale: 1.2, brightness: 0.7, opacity: 1,
  });
  blurStateRef.current = {
    on: blurOn,
    crop: seg?.crop,
    blur: blurBg?.blur ?? 60,
    scale: blurBg?.scale ?? 1.2,
    brightness: blurBg?.brightness ?? 0.7,
    opacity: blurBg?.opacity ?? 1,
  };
  useEffect(() => {
    if (!blurBg?.enabled || isMulti) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const st = blurStateRef.current;
      const canvas = blurCanvasRef.current, video = videoRef.current, box = boxRef.current;
      if (!canvas || !video || !box) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cw = box.clientWidth, ch = box.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!st.on || !vw || !vh) return;
      const c = st.crop && st.crop.w > 0 && st.crop.h > 0 ? st.crop : { x: 0, y: 0, w: 1, h: 1 };
      const sx = c.x * vw, sy = c.y * vh, sw = c.w * vw, sh = c.h * vh;
      const cover = Math.max(cw / sw, ch / sh) * (st.scale || 1);
      const dw = sw * cover, dh = sh * cover;
      ctx.save();
      ctx.globalAlpha = st.opacity ?? 1;
      ctx.filter = `blur(${(st.blur * 0.3).toFixed(1)}px) brightness(${st.brightness})`;
      try { ctx.drawImage(video, sx, sy, sw, sh, (cw - dw) / 2, (ch - dh) / 2, dw, dh); } catch { /* frame not ready */ }
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurBg?.enabled, isMulti, videoRef]);

  function commitPane(i: number, crop: CropRect) {
    const id = seg?.id;
    if (!id) return;
    onUpdate((d) => { const t = d.layout.find((s) => s.id === id); if (t?.panes?.[i]) t.panes[i].crop = crop; });
  }

  // Drag inside a pane → pan its crop (move which part of the source the slot shows).
  function startPanePan(i: number) {
    return (e: React.PointerEvent) => {
      if (e.button !== 0 || !panes) return;
      e.preventDefault();
      e.stopPropagation();
      setSelPane(i);
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const slot = slots[i];
      const paneWpx = slot.w * box.width;
      const paneHpx = slot.h * box.height;
      const c0 = { ...panes[i].crop };
      const sx = e.clientX, sy = e.clientY;
      let latest = c0;
      const move = (ev: PointerEvent) => {
        const dxn = ((ev.clientX - sx) / paneWpx) * c0.w;
        const dyn = ((ev.clientY - sy) / paneHpx) * c0.h;
        const x = Math.min(1 - c0.w, Math.max(0, c0.x - dxn));
        const y = Math.min(1 - c0.h, Math.max(0, c0.y - dyn));
        latest = { ...c0, x, y };
        setDraftPane({ i, crop: latest });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); commitPane(i, latest); setDraftPane(null); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Corner handle on the selected pane → zoom its crop (aspect-locked to the slot), centered.
  function startPaneZoom(i: number) {
    return (e: React.PointerEvent) => {
      if (!panes) return;
      e.preventDefault();
      e.stopPropagation();
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const slot = slots[i];
      const paneWpx = slot.w * box.width;
      const srcAR = srcDims.w / srcDims.h;
      const whRatio = slotAspect(slot, canvasAR) / srcAR; // crop.w / crop.h in normalized source
      const c0 = { ...panes[i].crop };
      const cxc = c0.x + c0.w / 2, cyc = c0.y + c0.h / 2;
      const sx = e.clientX;
      let latest = c0;
      const move = (ev: PointerEvent) => {
        const dxn = (ev.clientX - sx) / paneWpx;
        let w = Math.min(1, Math.max(0.12, c0.w + dxn));
        let h = w / whRatio;
        if (h > 1) { h = 1; w = h * whRatio; }
        const x = Math.min(1 - w, Math.max(0, cxc - w / 2));
        const y = Math.min(1 - h, Math.max(0, cyc - h / 2));
        latest = { x, y, w, h };
        setDraftPane({ i, crop: latest });
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); commitPane(i, latest); setDraftPane(null); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Drag handler factory for caption / text overlays (normalized canvas coords).
  function startDrag(onMove: (nx: number, ny: number) => void) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      const box = boxRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const nx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const ny = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
        onMove(nx, ny);
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  const canvasH = boxRef.current?.clientHeight ?? 640;
  const cropCorners: [0 | 1, 0 | 1][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const brollActive = edit.broll.some((b) => playhead >= b.start && playhead <= b.end);
  const showFrame = !brollActive; // the dotted frame is always on the base video (hidden under B-roll)

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-lg bg-black shadow-2xl"
        style={{ aspectRatio: String(canvasAR), height: "min(70vh, 100%)", maxWidth: "100%" }}
      >
        {/* Auto blurred background — a cover-scaled, blurred copy of the same source frame,
            drawn behind the base video to fill the bars in Fit mode (z below the video box). */}
        {blurBg?.enabled && !isMulti && (
          <canvas ref={blurCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 0 }} />
        )}

        {/* Base video — ONE always-mounted element so playback never resets when the playhead
            crosses a layout boundary (switching single↔multi must NOT remount the <video>).
            Single layout: it's the visible, movable/scalable box. Multi layout: it's hidden and
            used purely as the decode source composited into the slots on the <canvas> below. */}
        <div
          className="absolute"
          style={
            isMulti
              ? { left: 0, top: 0, width: "100%", height: "100%", overflow: "hidden", zIndex: 0, opacity: 0, pointerEvents: "none" }
              : { left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%`, overflow: "hidden", zIndex: 1, ...transitionStyle }
          }
        >
          <video
            ref={videoRef}
            src={sourceVideoUrl ?? `/api/clip/${jobId}/source`}
            playsInline
            muted={false}
            preload="auto"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = edit.sourceInSec + windowT;
              setSrcDims({ w: e.currentTarget.videoWidth || 16, h: e.currentTarget.videoHeight || 9 });
            }}
            style={isMulti ? { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" } : videoInBox}
          />
        </div>

        {/* Multiple-speaker layout — composite the ONE decoded source into N slots on a canvas
            (smooth, perfectly synced). Transparent per-slot handles edit each pane's crop:
            drag a slot to pan its crop; the selected slot's corner handle zooms it. */}
        {isMulti && (
          <>
            <canvas ref={multiCanvasRef} className="absolute inset-0 h-full w-full" style={{ zIndex: 1, ...transitionStyle }} />
            {slots.slice(0, panes?.length ?? 0).map((slot, i) => {
              const selected = selPane === i;
              return (
                <div
                  key={i}
                  onPointerDown={startPanePan(i)}
                  className={`absolute z-10 cursor-move border ${selected ? "border-white" : "border-white/40 hover:border-white/70"}`}
                  style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%`, width: `${slot.w * 100}%`, height: `${slot.h * 100}%` }}
                >
                  {selected && (
                    <span
                      onPointerDown={startPaneZoom(i)}
                      className="absolute bottom-0 right-0 z-30 h-4 w-4 cursor-nwse-resize border-2 border-white bg-black/60"
                    />
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Always-on reframe box: drag to move, corners scale (aspect-locked) */}
        {showFrame && !isMulti && (
          <div
            onPointerDown={startMove}
            className="absolute z-20 cursor-move border-2 border-dashed border-white/90"
            style={{ left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` }}
          >
            {cropCorners.map(([cx, cy]) => (
              <div
                key={`${cx}-${cy}`}
                onPointerDown={startResize(cx, cy)}
                className="absolute h-4 w-4 rounded-full border-2 border-white bg-black/60"
                style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, transform: "translate(-50%,-50%)", cursor: cx === cy ? "nwse-resize" : "nesw-resize" }}
              />
            ))}
          </div>
        )}

        {/* Magnetic alignment guides — shown only while a snap is active during a drag */}
        {snap?.x && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-40 w-px bg-cyan-400"
            style={{ left: snap.x === "left" ? "0%" : snap.x === "right" ? "100%" : "50%" }}
          />
        )}
        {snap?.y && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-40 h-px bg-cyan-400"
            style={{ top: snap.y === "top" ? "0%" : snap.y === "bottom" ? "100%" : "50%" }}
          />
        )}

        {/* B-roll — full-frame replacement of the base video on its time range */}
        {edit.broll
          .filter((b) => playhead >= b.start && playhead <= b.end)
          .map((b) => {
            const isVideo = /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(b.src);
            const fit: CSSProperties["objectFit"] = b.mode === "fit" ? "contain" : "cover";
            return (
              <div key={b.id} className="absolute inset-0 z-[15] bg-black">
                {isVideo ? (
                  <video src={b.src} className="h-full w-full" style={{ objectFit: fit }} muted loop autoPlay playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.src} alt="" className="h-full w-full" style={{ objectFit: fit }} />
                )}
              </div>
            );
          })}

        {/* Caption layer — draggable to set caption.offset */}
        <CaptionLayer
          config={edit.caption}
          words={windowedWords}
          windowT={windowT}
          canvasH={canvasH}
          onPointerDown={startDrag((nx, ny) =>
            onUpdate((d) => {
              d.caption.offset = { x: nx, y: ny };
            })
          )}
        />

        {/* Text overlays (hook chip, titles) — draggable + selectable */}
        {edit.textOverlays
          .filter((o) => playhead >= o.start && playhead <= o.end)
          .map((o) => {
            const selected = selectedTextId === o.id;
            return (
              <div
                key={o.id}
                onPointerDown={(e) => {
                  onSelectText?.(o.id);
                  startDrag((nx, ny) =>
                    onUpdate((d) => {
                      const t = d.textOverlays.find((x) => x.id === o.id);
                      if (t) { t.x = nx; t.y = ny; }
                    })
                  )(e);
                }}
                className={`absolute z-30 cursor-move select-none whitespace-pre-wrap font-semibold ${selected ? "ring-2 ring-foreground" : ""}`}
                style={{
                  left: `${o.x * 100}%`,
                  top: `${o.y * 100}%`,
                  transform: "translate(-50%,-50%)",
                  background: o.style.bg,
                  color: o.style.color,
                  fontFamily: o.style.font,
                  fontSize: (o.style.sizePx * canvasH) / 1920,
                  fontWeight: o.style.bold ? 700 : 400,
                  fontStyle: o.style.italic ? "italic" : undefined,
                  textDecoration: o.style.underline ? "underline" : undefined,
                  textAlign: o.style.align ?? "center",
                  borderRadius: o.style.radiusPx,
                  padding: o.style.bg ? "4px 10px" : undefined,
                  maxWidth: `${o.style.widthPct ?? 80}%`,
                  opacity: o.style.opacity ?? 1,
                }}
              >
                {o.text}
              </div>
            );
          })}

        {/* Media overlays — draggable, corner-resizable */}
        {edit.mediaOverlays
          .filter((m) => playhead >= m.start && playhead <= m.end)
          .map((m) => (
            <div
              key={m.id}
              onPointerDown={startDrag((nx, ny) =>
                onUpdate((d) => {
                  const t = d.mediaOverlays.find((x) => x.id === m.id);
                  if (t) { t.x = Math.min(1 - t.w, Math.max(0, nx - t.w / 2)); t.y = Math.min(1 - t.h, Math.max(0, ny - t.h / 2)); }
                })
              )}
              className="group absolute z-[25] cursor-move"
              style={{
                left: `${m.x * 100}%`,
                top: `${m.y * 100}%`,
                width: `${m.w * 100}%`,
                height: `${m.h * 100}%`,
                opacity: m.opacity ?? 1,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.kind === "image" ? (
                <img src={m.src} alt="" className="pointer-events-none h-full w-full object-contain" />
              ) : (
                <video src={m.src} className="pointer-events-none h-full w-full object-contain" muted loop autoPlay />
              )}
              {/* resize handle (bottom-right) */}
              <span
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const box = boxRef.current?.getBoundingClientRect();
                  if (!box) return;
                  const move = (ev: PointerEvent) => {
                    const nw = Math.min(1 - m.x, Math.max(0.05, (ev.clientX - box.left) / box.width - m.x));
                    const nh = Math.min(1 - m.y, Math.max(0.05, (ev.clientY - box.top) / box.height - m.y));
                    onUpdate((d) => {
                      const t = d.mediaOverlays.find((x) => x.id === m.id);
                      if (t) { t.w = nw; t.h = nh; }
                    });
                  };
                  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
                className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-full border border-background bg-foreground opacity-0 group-hover:opacity-100"
              />
            </div>
          ))}
      </div>
    </div>
  );
}
