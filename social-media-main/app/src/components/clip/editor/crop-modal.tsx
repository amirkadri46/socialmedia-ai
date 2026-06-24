"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, ScanFace } from "lucide-react";
import { aspectRatioValue } from "@/lib/clip/layout-geom";
import type { CropRect, LayoutKind } from "@/lib/types";

// Aspect options offered by the crop chooser (matches OpusClip). "custom" = free resize,
// "original" = the source's own aspect (whole frame).
const ASPECTS = ["custom", "original", "9:16", "1:1", "16:9", "4:3", "9:8", "4:5"] as const;

/**
 * Crop dialog: a draggable rectangle over the source frame that selects the kept region.
 * The aspect dropdown locks the rectangle's shape (or "custom" = free). Coordinates are
 * normalized 0–1 of the source frame; the chosen aspect label is returned alongside.
 */
export function CropModal({
  jobId,
  clipId,
  sourceTime,
  aspect,
  crop,
  cropAspect,
  layoutKind = "single",
  onEnableLayout,
  onApply,
  onClose,
}: {
  jobId: string;
  clipId: string;
  sourceTime: number;
  aspect: string; // clip output aspect (default selection)
  crop?: CropRect;
  cropAspect?: string;
  layoutKind?: LayoutKind; // current speaker layout of the active segment (3D)
  onEnableLayout?: (kind: LayoutKind) => void; // switch single/split/triple/quad
  onApply: (c: CropRect, cropAspect: string) => void;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dims, setDims] = useState({ w: 16, h: 9 });
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [selAspect, setSelAspect] = useState<string>(cropAspect || aspect || "9:16");

  // Region pixel-aspect for the current selection, and the normalized w/h lock factor
  // (normalized w = k · h so the pixel aspect matches). "custom" = no lock.
  const srcAR = dims.w / dims.h;
  const regionAR = selAspect === "original" ? srcAR : aspectRatioValue(selAspect);
  const locked = selAspect !== "custom";
  const k = regionAR / srcAR; // normalized w = k * normalized h

  const defaultRect = (): CropRect => {
    if (!locked) return crop ?? { x: 0, y: 0, w: 1, h: 1 };
    let h = 1, w = k * h;
    if (w > 1) { w = 1; h = w / k; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  };

  const [rect, setRect] = useState<CropRect>(crop ?? defaultRect());

  // Prevent the aspect/dims effect from overwriting an auto-detected or caller-supplied crop.
  const skipNextReset = useRef(false);
  const prevSelAspectRef = useRef(selAspect);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Seek to the requested source time and make sure a real frame is actually decoded —
    // a freshly-mounted <video> in a dialog otherwise stays on a black undecoded frame.
    const seekToFrame = () => {
      setDims({ w: v.videoWidth || 16, h: v.videoHeight || 9 });
      const t = Math.max(0.05, sourceTime); // avoid the often-black very first frame
      try { v.currentTime = t; } catch { /* ignore */ }
    };
    // Nudge decoding once data is available (some browsers won't paint a paused frame
    // until a tiny seek forces a decode).
    const ensurePainted = () => {
      if (v.readyState < 2 || v.videoWidth === 0) return;
      if (Math.abs(v.currentTime - Math.max(0.05, sourceTime)) > 0.5) {
        try { v.currentTime = Math.max(0.05, sourceTime); } catch { /* ignore */ }
      }
    };
    if (v.readyState >= 1) seekToFrame();
    else v.addEventListener("loadedmetadata", seekToFrame, { once: true });
    v.addEventListener("loadeddata", ensurePainted);
    return () => v.removeEventListener("loadeddata", ensurePainted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit the rectangle when the aspect changes. When only dims load (video ready) and
  // the caller already supplied a crop, keep it rather than clobbering with the default.
  useEffect(() => {
    if (skipNextReset.current) { skipNextReset.current = false; return; }
    const aspectChanged = selAspect !== prevSelAspectRef.current;
    prevSelAspectRef.current = selAspect;
    if (!aspectChanged && crop) return;
    setRect(defaultRect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selAspect, dims.w, dims.h]);

  function clampRect(r: CropRect, lockK?: number): CropRect {
    let w = Math.min(1, Math.max(0.1, r.w));
    let h = Math.min(1, Math.max(0.1, r.h));
    // When the aspect is locked (lockK = w/h), re-impose the ratio after the per-axis
    // min/max so a tiny drag near a corner can't collapse the rect into a square that no
    // longer matches the chosen output aspect.
    if (lockK && lockK > 0) {
      if (w / h > lockK) w = h * lockK;
      else h = w / lockK;
      if (w < 0.1) { w = 0.1; h = w / lockK; }
      if (h < 0.1) { h = 0.1; w = h * lockK; }
      w = Math.min(1, w);
      h = Math.min(1, h);
    }
    const x = Math.min(1 - w, Math.max(0, r.x));
    const y = Math.min(1 - h, Math.max(0, r.y));
    return { x, y, w, h };
  }

  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const r0 = { ...rect };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / box.width;
      const dy = (ev.clientY - startY) / box.height;
      setRect(clampRect({ ...r0, x: r0.x + dx, y: r0.y + dy }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Corner resize: aspect-locked unless "custom" (then free).
  function startResize(cornerX: 0 | 1, cornerY: 0 | 1) {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const box = frameRef.current?.getBoundingClientRect();
      if (!box) return;
      const fixedX = rect.x + (1 - cornerX) * rect.w;
      const fixedY = rect.y + (1 - cornerY) * rect.h;
      const move = (ev: PointerEvent) => {
        const px = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
        const py = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
        let w = Math.abs(px - fixedX);
        let h = Math.abs(py - fixedY);
        if (locked) {
          h = w / k;
          if (h > Math.abs(py - fixedY)) { h = Math.abs(py - fixedY); w = k * h; }
        }
        const x = cornerX === 1 ? fixedX : fixedX - w;
        const y = cornerY === 1 ? fixedY : fixedY - h;
        setRect(clampRect({ x, y, w, h }, locked ? k : undefined));
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  const corners: [0 | 1, 0 | 1][] = [[0, 0], [1, 0], [0, 1], [1, 1]];

  async function autoDetect() {
    setAutoDetecting(true);
    setAutoError(null);
    try {
      const res = await fetch(`/api/clip/${jobId}/${clipId}/face-crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspect }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Detection failed.");
      skipNextReset.current = true; // prevent the dims/aspect effect from overwriting the detected crop
      setSelAspect(aspect); // face crop targets the output aspect
      setRect(clampRect(data.crop as CropRect));
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : "Face detection failed.");
    } finally {
      setAutoDetecting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Crop</DialogTitle>
          <DialogDescription>
            Choose an aspect ratio and drag the frame to pick the region kept from the source.
          </DialogDescription>
        </DialogHeader>

        {/* OpusClip note: multi-speaker layouts live in the editor (now functional). */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>To accommodate multiple speakers, please enable multiple speaker layouts (split, three, four).</span>
          {onEnableLayout && (
            <select
              value={layoutKind}
              onChange={(e) => {
                const k = e.target.value as LayoutKind;
                onEnableLayout(k);
                if (k !== "single") onClose(); // edit the panes inline on the preview
              }}
              title="Enable layout"
              className="rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground outline-none"
            >
              <option value="single">Enable layout…</option>
              <option value="split">Split · 2</option>
              <option value="triple">Triple · 3</option>
              <option value="quad">Quad · 4</option>
            </select>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Aspect ratio</span>
          <select
            value={selAspect}
            onChange={(e) => setSelAspect(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none"
          >
            {ASPECTS.map((a) => (
              <option key={a} value={a}>{a === "custom" ? "Custom" : a === "original" ? "Original" : a}</option>
            ))}
          </select>
        </div>

        <div ref={frameRef} className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
          <video ref={videoRef} src={`/api/clip/${jobId}/source`} className="h-full w-full object-contain" muted playsInline preload="auto" />
          <div
            onPointerDown={startMove}
            className="absolute cursor-move border-2 border-white"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              // Subtle dim of the area outside the kept region — light enough that the whole
              // source frame stays clearly visible while positioning the crop (no "blackout").
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.2)",
            }}
          >
            {corners.map(([cx, cy]) => (
              <div
                key={`${cx}-${cy}`}
                onPointerDown={startResize(cx, cy)}
                className="absolute h-4 w-4 rounded-full border-2 border-white bg-black/60"
                style={{
                  left: `${cx * 100}%`, top: `${cy * 100}%`,
                  transform: "translate(-50%,-50%)",
                  cursor: cx === cy ? "nwse-resize" : "nesw-resize",
                }}
              />
            ))}
          </div>
        </div>

        {autoError && (
          <p className="text-xs text-destructive">{autoError}</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={autoDetect}
            disabled={autoDetecting}
            title="Detect face position using AI and auto-center the crop"
          >
            {autoDetecting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ScanFace className="h-4 w-4" />}
            Auto Face Crop
          </Button>
          <Button variant="outline" onClick={() => setRect(defaultRect())}>Reset</Button>
          <Button onClick={() => onApply(clampRect(rect), selAspect)}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
