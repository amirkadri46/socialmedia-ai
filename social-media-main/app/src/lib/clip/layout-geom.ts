import type { CropRect, LayoutKind, LayoutSegment, VideoFrame } from "../types";

// Shared framing geometry for the "video-as-object" model (preview + export parity).
// A segment maps the source into the output canvas in two steps:
//   1. crop  — which region of the source is kept (set in the Crop modal; whole frame by default)
//   2. frame — where/how big that region sits inside the output canvas (move/scale on the preview)
// `frame` is normalized to the canvas (0–1); it may exceed [0,1] (Fill = overflow, canvas crops)
// or sit inside it with black bars (Fit). When a segment has no explicit `frame`, it is derived
// from `mode` (fill = cover, fit = contain), centered.

/** Output/crop aspect label → width/height ratio. */
export function aspectRatioValue(aspect: string | undefined): number {
  switch (aspect) {
    case "1:1": return 1;
    case "16:9": return 16 / 9;
    case "4:3": return 4 / 3;
    case "9:8": return 9 / 8;
    case "4:5": return 4 / 5;
    case "9:16": return 9 / 16;
    default: return 9 / 16;
  }
}

/** Pixel aspect (w/h) of the kept source region. */
export function cropRegionAspect(seg: LayoutSegment | undefined, srcW: number, srcH: number): number {
  const c = seg?.crop;
  const w = (c && c.w > 0 ? c.w : 1) * srcW;
  const h = (c && c.h > 0 ? c.h : 1) * srcH;
  return h > 0 ? w / h : srcW / srcH;
}

/** Cover the canvas (Fill): the region overflows; canvas crops the excess. Centered. */
export function coverFrame(regionAR: number, canvasAR: number): VideoFrame {
  let w: number, h: number;
  if (regionAR > canvasAR) { h = 1; w = regionAR / canvasAR; }
  else { w = 1; h = canvasAR / regionAR; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Fit the region inside the canvas (Fit): whole region visible, black bars. Centered. */
export function containFrame(regionAR: number, canvasAR: number): VideoFrame {
  let w: number, h: number;
  if (regionAR > canvasAR) { w = 1; h = canvasAR / regionAR; }
  else { h = 1; w = regionAR / canvasAR; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Largest centered source crop with the given pixel aspect (w/h). Whole frame if it fits. */
export function centeredCrop(aspectVal: number, srcW: number, srcH: number): CropRect {
  const srcAR = srcH > 0 ? srcW / srcH : 1;
  const r = aspectVal / srcAR; // region w/h in normalized source units
  let w: number, h: number;
  if (r >= 1) { w = 1; h = 1 / r; } else { h = 1; w = r; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

// ── Multiple-speaker layouts (3D) ────────────────────────────────────────────────────
// A multi-speaker segment tiles N face-crops of the SAME source into equal canvas slots.
// Each pane's crop is built to its slot's pixel aspect, so the slot is fully covered
// (no overflow, no bars) — classic split-screen. Preview + export share these slots.

/** Number of panes for a layout kind. */
export function paneCount(kind: LayoutKind | undefined): 1 | 2 | 3 | 4 {
  return kind === "split" ? 2 : kind === "triple" ? 3 : kind === "quad" ? 4 : 1;
}

/** Canvas-normalized slot rectangles for a layout kind (2/3 stacked rows; quad = 2×2 grid). */
export function splitSlots(kind: LayoutKind | undefined): VideoFrame[] {
  switch (kind) {
    case "split":
      return [
        { x: 0, y: 0, w: 1, h: 1 / 2 },
        { x: 0, y: 1 / 2, w: 1, h: 1 / 2 },
      ];
    case "triple":
      return [
        { x: 0, y: 0, w: 1, h: 1 / 3 },
        { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
        { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
      ];
    case "quad":
      return [
        { x: 0, y: 0, w: 1 / 2, h: 1 / 2 },
        { x: 1 / 2, y: 0, w: 1 / 2, h: 1 / 2 },
        { x: 0, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
        { x: 1 / 2, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
      ];
    default:
      return [{ x: 0, y: 0, w: 1, h: 1 }];
  }
}

/** Pixel aspect (w/h) of a canvas slot, given the canvas aspect. */
export function slotAspect(slot: VideoFrame, canvasAR: number): number {
  return slot.h > 0 ? (slot.w / slot.h) * canvasAR : canvasAR;
}

/** The segment's video-box placement in the canvas — explicit `frame`, else derived from `mode`. */
export function resolveFrame(
  seg: LayoutSegment | undefined,
  srcW: number,
  srcH: number,
  canvasAR: number
): VideoFrame {
  if (seg?.frame) return seg.frame;
  const regionAR = cropRegionAspect(seg, srcW, srcH);
  return seg?.mode === "fit" ? containFrame(regionAR, canvasAR) : coverFrame(regionAR, canvasAR);
}
