# PRD — Phase 3D: Multiple-speaker layouts (split / triple / quad)

**Created:** 2026-06-21
**Status:** In implementation
**Builds on:** `plans/2026-06-21-clip-editor-phase3-opusclip-enhancements.md` (§3C.1b deferred this as the disabled *"Enable layout"* link — this doc promotes it to a real feature).
**Same spine rule:** one `ClipEdit` JSON document; the browser preview **and** the ffmpeg export stay pure functions of it.

## Goal

OpusClip's crop modal shows: *"To accommodate multiple speakers, please enable multiple speaker layouts in the editor (split, three, four)."* Implement that for real. A `LayoutSegment` can stack **2 (split), 3 (triple), or 4 (quad)** face-crops of the **same source video** into tiled slots of the 9:16 output canvas. Each pane is an independently editable face-crop. Auto-detection seeds the panes; the user can drag/zoom each. Export reproduces it exactly.

## Model (one source, N panes)

Today each `LayoutSegment` is a single "video-as-object": one `crop` (source region) placed into one `frame` (canvas box). Multi-speaker = **N crops of the same source, each scaled to fill its own canvas slot** (no overflow, no bars — classic split-screen).

### Schema — `app/src/lib/types.ts`
```ts
export type LayoutKind = "single" | "split" | "triple" | "quad"; // 1 / 2 / 3 / 4 panes

export interface SpeakerPane {
  crop: CropRect;     // source region for this speaker (slot pixel-aspect, face-centered)
  label?: string;     // optional ("Speaker 1")
}

// added to LayoutSegment:
//   kind?: LayoutKind;        // default "single" → existing single-frame behavior
//   panes?: SpeakerPane[];    // present when kind != "single" (length 2/3/4)
```
`kind` absent / `"single"` = today's behavior (backward compatible; every reader guards). When `kind` is multi and `panes` has ≥2 entries, the segment renders as a split.

### Geometry — `app/src/lib/clip/layout-geom.ts`
- `paneCount(kind): 1|2|3|4`.
- `splitSlots(kind): VideoFrame[]` — canvas-normalized slot rects:
  - `split` → 2 stacked rows `[{0,0,1,.5},{0,.5,1,.5}]`
  - `triple` → 3 stacked rows (each `h=1/3`)
  - `quad` → 2×2 grid (each `.5×.5`)
- `slotAspect(slot, canvasAR): number` — pixel aspect of a slot = `(slot.w/slot.h)*canvasAR`. Each pane's crop is built to **this** aspect so it fills the slot with no letterbox.

### Detection — `app/src/lib/clip/autoframe.ts` + new route
- `detectSpeakerPanes(jobId, sourceInSec, sourceOutSec, kind, canvasAR): Promise<SpeakerPane[]>` — sample a few frames in the segment window, ask the model for up to N distinct face centers (Gemini contact-sheet default, GPT-4o fallback, both already wired), sort left→right / top→bottom, and `buildCropRectForAspect(cx,cy,srcW,srcH,slotAspect_i)` per pane. Fewer faces than N → fill remaining panes with sensible centered crops.
- New `POST /api/clip/[jobId]/[clipId]/speakers { kind, sourceInSec, sourceOutSec } → { panes }`.
- `face-crop.ts`: extract `buildCropRectForAspect(cx,cy,srcW,srcH,targetAR:number)`; keep `buildCropRect` as the string-aspect wrapper.

### Preview — `preview-canvas.tsx`
- When the active `seg.kind` is multi: render N pane `<div>`s (each positioned/sized to its slot, `overflow:hidden`), each containing a `<video src>` cropped by `pane.crop` (same crop CSS as today). Pane 0 uses `videoRef` (drives playback); panes 1..N-1 are extra `<video>`s synced to `videoRef.currentTime` (timeupdate + play/pause mirror).
- Per-pane edit: each pane has a dashed border; dragging **pans** that pane's crop, corners **zoom** it (aspect-locked to the slot). Writes `panes[i].crop`. Selecting a pane highlights it.
- Toolbar gains a **Layout** control (Single / Split / Triple / Quad). Choosing multi calls the speakers endpoint to seed panes (optimistic default crops first); choosing Single drops `panes`.

### Export — `editRender.ts` `framePieceFilters`
- Single (existing): unchanged.
- Multi: `split` the trimmed source into N, `crop` each to its pane region, `scale` each to its slot pixel size, then chain `overlay` of all panes onto one black `w×h` canvas at each slot offset → `[v{n}]`. Exact mirror of the preview (each slot is fully covered, no bars).

### Crop modal — `crop-modal.tsx`
- Add the OpusClip note line and turn **"Enable layout"** into a real control: a small Single/Split/Triple/Quad selector that sets the active segment's `kind` (and seeds panes via the same path). No longer disabled "soon".

### Timeline — `timeline.tsx`
- Fill/Fit chip label shows the layout (`Split`/`Triple`/`Quad`) when a segment is multi.

## Acceptance
- Enabling Split/Triple/Quad on a segment stacks N face-crops of the source; each pane is independently drag/zoom-editable.
- Auto-detection seeds panes to detected speakers (fallback to centered crops without a vision key).
- Preview and exported mp4 match for every layout kind; `npm run build` passes.
- Single-pane clips and old edits without `kind`/`panes` still load and render unchanged.
