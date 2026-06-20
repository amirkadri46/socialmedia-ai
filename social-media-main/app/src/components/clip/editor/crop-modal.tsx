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
import type { CropRect } from "@/lib/types";

function targetAR(aspect: string): number {
  switch (aspect) {
    case "1:1": return 1;
    case "16:9": return 16 / 9;
    case "9:16":
    default: return 9 / 16;
  }
}

/**
 * Crop dialog (OpusClip-style): a draggable, aspect-locked rectangle over the source
 * frame. The rect is constrained to the clip's output aspect so the crop maps 1:1 to
 * the export with no distortion. Coordinates are normalized 0–1 of the source frame.
 */
export function CropModal({
  jobId,
  clipId,
  sourceTime,
  aspect,
  crop,
  onApply,
  onClose,
}: {
  jobId: string;
  clipId: string;
  sourceTime: number;
  aspect: string;
  crop?: CropRect;
  onApply: (c: CropRect) => void;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dims, setDims] = useState({ w: 16, h: 9 });
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  // Aspect lock in normalized space: width/height ratio so pixel aspect == targetAR.
  const k = (targetAR(aspect) * dims.h) / dims.w; // normalized w = k * normalized h

  const defaultRect = (): CropRect => {
    let h = 1;
    let w = k * h;
    if (w > 1) { w = 1; h = w / k; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  };

  const [rect, setRect] = useState<CropRect>(crop ?? defaultRect());

  // Seek the preview frame to the current playhead position.
  useEffect(() => {
    const v = videoRef.current;
    if (v) {
      const onMeta = () => {
        setDims({ w: v.videoWidth || 16, h: v.videoHeight || 9 });
        try { v.currentTime = sourceTime; } catch { /* ignore */ }
      };
      if (v.readyState >= 1) onMeta();
      else v.addEventListener("loadedmetadata", onMeta, { once: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-default the rect once we know real dimensions (only if no saved crop).
  useEffect(() => {
    if (!crop) setRect(defaultRect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.w, dims.h]);

  function clampRect(r: CropRect): CropRect {
    const w = Math.min(1, Math.max(0.1, r.w));
    const h = Math.min(1, Math.max(0.1, r.h));
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

  // Aspect-locked corner resize: opposite corner stays fixed; width drives height.
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
        let h = w / k; // lock aspect (w = k*h)
        // If height-driven would exceed available vertical room, fall back to py.
        const wantH = Math.abs(py - fixedY);
        if (wantH < h) { h = wantH; w = k * h; }
        const x = cornerX === 1 ? fixedX : fixedX - w;
        const y = cornerY === 1 ? fixedY : fixedY - h;
        setRect(clampRect({ x, y, w, h }));
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
            Drag the {aspect} frame to choose what stays in view. Resize from any corner (aspect locked).
          </DialogDescription>
        </DialogHeader>

        <div ref={frameRef} className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${dims.w} / ${dims.h}` }}>
          <video ref={videoRef} src={`/api/clip/${jobId}/source`} className="h-full w-full object-contain" muted playsInline preload="metadata" />
          {/* Crop rectangle — its boxShadow dims everything outside the rect */}
          <div
            onPointerDown={startMove}
            className="absolute cursor-move border-2 border-white"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
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
          <Button onClick={() => onApply(clampRect(rect))}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
