# PRD — Phase 3: OpusClip-Parity Clip Editor (Script + Timeline + Auto-Reframe)

**Created:** 2026-06-21
**Status:** Ready for implementation
**Target executor:** Claude Code (Opus 4.8)
**Builds on:** `plans/2026-06-19-clip-editor-phase2-prd.md` (Phase 2 editor — already implemented and shipped).
**Scope rule:** This document covers **only** the new enhancements Aamir defined in the planning chat. Phase 1/2 features are already built — **do not rebuild them.** Extend the existing files listed below.

> **⚠️ REFERENCE IMAGES — CHECK THESE FIRST.** Aamir is attaching all 7–8 OpusClip reference screenshots directly in Claude Code. **Look at the attached images before implementing each sub-phase** — they are the visual source of truth for layout, spacing, colors, and behavior. The captions below map each image to its feature, but the attached images override any text description if they differ.
>
> **Reference images (attached by Aamir in Claude Code).** Some show OpusClip (the TARGET to copy); some show Aamir's current app (marked INCORRECT — do not keep that behavior).
>
> *Script panel (target):*
> - Words highlighted green/yellow as the speaker talks; word/selection popup (`Add ▾ | Edit | Highlight ▾ | 🗑`); silence chips (`0.38s`); `Speech cleanup`, `Extend a clip`.
> - `Highlight ▾` dropdown — Font color, Highlight 1 (green), Highlight 2 (yellow), Customize.
>
> *Crop (target = OpusClip):*
> - **Inline crop frame on the preview** — clean floating toolbar (crop icon + add-image icon + chevron) above a **square-cornered** selection box with round corner handles. **No rounded corners on the overlay layer.**
> - **Crop modal** — opens when Crop is clicked: an **Aspect ratio dropdown** (`Custom`, `Original`, `9:16`, `1:1`, `16:9`, `4:3`, `9:8`, `4:5`), a draggable crop rect over the **full source frame**, `Reset` / `Apply`, and an "enable multiple speaker layouts" note with an `Enable layout` link.
>
> *Crop (INCORRECT — Aamir's current app):* the inline `Fill | Fit | Crop` toolbar rendered as a **rounded pill layer** over the video, and Crop not opening the ratio modal. **Replace this.**
>
> *Timeline (target = OpusClip):* full-width multi-track — caption track (e.g. "Beasty"), **OVERLAYS** track (green chips: text, "B-roll", "New text"), per-segment **Fill/Fit framing chips**, **VIDEO thumbnail filmstrip**, **AUDIO waveform**; transport with **Split / Delete / Mute / Add**, zoom; segments are **selectable, splittable, trimmable, and their cut boundaries drag left/right** (real video-editing behavior).

---

## 0. Decisions locked in chat (treat as requirements)

1. **Sequencing:** Build sub-phase by sub-phase (3A → 3B → 3C). **Stop after each sub-phase for Aamir to review the code before starting the next.** Do not start 3B until 3A is reviewed/approved, etc.
2. **Fill/Fit logic:** **Auto-detect, then editable** — detection segments the clip into Fill/Fit, and the user can override any segment.
3. **Transcript popup depth:** **Highlight + Edit + Delete only.** No "Timing" option. `Add ▸ AI/Stock B-Roll / Emoji / AI hook` from the reference are **out of scope** for the popup (may be shown disabled "soon").
4. **Crop frame:** **Inline on the preview AND keep the modal.** The modal stays the default for framing the speaker; the inline frame is for quick per-segment adjustment. The auto-changing frame is driven by a fast AI model (see §3C.4). **Match OpusClip exactly (images):** the inline frame's overlay layer + toolbar must have **square corners (no border-radius)** — Aamir's current rounded `Fill | Fit | Crop` pill is wrong; clicking **Crop** must open the modal, and the modal must include an **Aspect ratio dropdown** (`Custom / Original / 9:16 / 1:1 / 16:9 / 4:3 / 9:8 / 4:5`).
5. **Timeline = real video editor, rebuilt from scratch.** Aamir's current timeline is non-functional (cuts don't behave like a real NLE). **Re-create the whole timeline to behave like OpusClip / a basic real video editor** (see §3B.0): cutting splits the video into real selectable segments whose cut boundaries **drag left/right**, segments trim/delete, the filmstrip + waveform are real, and framing is per-segment. **Research how a basic NLE timeline behaves and build it for real**, using **shadcn/ui components** for the surrounding controls.

---

## 1. Foundation already built — DO NOT rebuild (reference only)

These exist and are the substrate Phase 3 extends. Read them before editing.

| Area | File(s) | What already works |
| --- | --- | --- |
| Edit document | `app/src/lib/types.ts` (`ClipEdit`, `LayoutSegment`, `CaptionConfig`, `TextOverlay`, `MediaOverlay`, `BrollSegment`, `AudioTrack`, `RemovedRange`, `CropRect`, `Word`) | Full schema; `LayoutSegment` already supports `mode: "fill"|"fit"` + per-segment `crop`. |
| Time math | `app/src/lib/clip/edit-timeline.ts` | `editedDuration`, `editedToWindow`, `editedToSource`, `windowToEdited`, `keptSegments`, `nextKeptWindow`, `layoutAt`, `windowWords`, `isRemoved`. **Layout segment `start/end` are in EDITED-timeline coords.** |
| State hook | `app/src/components/clip/editor/use-clip-edit.ts` | Loads `{edit, words, clip}`, debounced autosave, undo/redo, `update(mutator)`. |
| Shell | `app/src/components/clip/editor/editor-shell.tsx` | 3-column layout, transport, zoom buttons, panels, crop modal wiring, SSE export. Global Fill/Fit toggle (`setLayoutMode` applies to ALL segments — to be replaced by per-segment in 3C). |
| Preview | `app/src/components/clip/editor/preview-canvas.tsx` | Renders base `<video>` with fill/fit/crop framing, caption layer, draggable text + media overlays. |
| Transcript | `app/src/components/clip/editor/transcript-panel.tsx` | Word tokens (click = toggle remove, dbl-click = seek), silence chips, Speech cleanup, Extend a clip. **Interaction model is rewritten in 3A.** |
| Timeline | `app/src/components/clip/editor/timeline.tsx` | Ruler scrub, Ctrl+wheel zoom, lanes (Video/Captions/Overlays/Audio), drag/trim of overlay+audio segments. **Replaced with the Opus-style timeline in 3B.** |
| Crop | `app/src/components/clip/editor/crop-modal.tsx` | Aspect-locked draggable crop rect → `LayoutSegment.crop`; `Auto Face Crop` button. Keep; inline version added in 3C. |
| Captions parity | `app/src/components/clip/editor/caption-render.tsx` (client) + `app/src/lib/clip/caption-styles.ts` (presets) + `app/src/lib/clip/captions.ts` `buildAssFromConfig` (server ASS) | The three parity sources. **Any new caption field must be added to all of them.** |
| Export | `app/src/lib/clip/editRender.ts` (`exportEdit`, `editedWords`) | pass 1 cuts+reframe (currently uses `layout[0]` only); pass 2 captions+overlays+audio. **Per-segment reframe added in 3C.** |
| Server utils | `app/src/lib/clip/ffmpeg.ts` (`ffmpeg(args,opts)`, `probe(path)`), `app/src/lib/clip/store.ts` (`readEdit`/`writeEdit`/`getDefaultEdit`/`readTranscript`, `clipMediaDir()`, assets dir `data/clips/assets/{clipId}`), `app/src/lib/clip/face-crop.ts` (`detectFaceCrop`, GPT-4o vision) | Reuse these. Source video lives at `os.tmpdir()/social-clipper/{jobId}/source.mp4`; streamed by `GET /api/clip/[jobId]/source`. |
| Edit API | `app/src/app/api/clip/[jobId]/[clipId]/edit/route.ts` | `GET → {edit, words, clip}`, `PUT` persists whole `ClipEdit` JSON (no schema stripping — new optional fields persist automatically). |

---

## 2. The spine (unchanged, still mandatory)

One `ClipEdit` JSON document is the single source of truth. **Both** the browser preview **and** the ffmpeg export must remain pure functions of it. Every Phase 3 change must keep preview and export in sync. New per-word / per-segment data added below must flow into both `caption-render.tsx`/`preview-canvas.tsx` (preview) **and** `captions.ts`/`editRender.ts` (export).

Transcript `Word.start/end` are **source seconds** (absolute), loaded from `data/clip-transcripts/{jobId}.json`. `removed` ranges and `LayoutSegment` times are **edited/window** coords. Use the helpers in `edit-timeline.ts` for every conversion — never hand-roll time math.

---

# SUB-PHASE 3A — Script editor (transcript highlight, click-seek, popup)

**Goal:** Make the left transcript panel behave like OpusClip's Script tab (images 1–3): the spoken word highlights live as the video plays, clicking a word jumps the video + playhead to that moment, and selecting a word or dragging across a sentence opens a popup with **Highlight / Edit / Delete**. Highlights and edits must show in the transcript, the live caption preview, **and** the exported mp4.

### 3A.1 Schema additions — `app/src/lib/types.ts`

```ts
// Per-word style overrides, keyed by the word's SOURCE start time (Word.start).
export interface WordStyle {
  t: number;        // = Word.start in source seconds (stable key)
  color?: string;   // highlight / font color, hex (e.g. "#3BE477"); undefined = none
  text?: string;    // edited replacement text (undefined = original)
}
```
- Add `color?: string;` to the existing `Word` interface (optional resolved render color; safe — `Word` is reused widely).
- Add `wordStyles?: WordStyle[];` to `ClipEdit`.
- In `getDefaultEdit` (`app/src/lib/clip/store.ts`) add `wordStyles: []` for cleanliness (optional — readers must still guard with `?? []`).

### 3A.2 Style resolution — `app/src/lib/clip/edit-timeline.ts`

Update `windowWords(edit, words)` to apply `wordStyles` while rebasing (match by `Math.abs(s.t - w.start) < 1e-3`):

```ts
export function windowWords(edit: ClipEdit, words: Word[]): Word[] {
  const styles = edit.wordStyles ?? [];
  return words
    .filter((w) => w.end > edit.sourceInSec && w.start < edit.sourceOutSec)
    .map((w) => {
      const st = styles.find((s) => Math.abs(s.t - w.start) < 1e-3);
      return {
        text: st?.text ?? w.text,
        start: w.start - edit.sourceInSec,
        end: w.end - edit.sourceInSec,
        color: st?.color,
      };
    });
}
```

### 3A.3 Transcript panel rewrite — `app/src/components/clip/editor/transcript-panel.tsx`

Keep: `Speech cleanup`, `Extend a clip`, silence gap chips, footer line, `mergeRanges`. Replace the word-token interaction model.

**New prop:** `playhead: number` (edited-timeline seconds), passed from the shell.

Build a display list directly from raw `words` (so source start is retained for keying):
```ts
const dwords = words.filter(w => w.end > edit.sourceInSec && w.start < edit.sourceOutSec).map((w,i) => ({
  i, src: w.start,
  text: (edit.wordStyles ?? []).find(s => Math.abs(s.t - w.start) < 1e-3)?.text ?? w.text,
  color: (edit.wordStyles ?? []).find(s => Math.abs(s.t - w.start) < 1e-3)?.color,
  ws: w.start - edit.sourceInSec, we: w.end - edit.sourceInSec,
  removed: edit.removed.some(r => (w.start - edit.sourceInSec) < r.end && (w.end - edit.sourceInSec) > r.start),
}));
```

**Live highlight + auto-scroll:**
- `const winT = editedToWindow(edit, playhead);` active = `dwords.find(d => winT >= d.ws && winT < d.we)`.
- Active word styled distinctly (e.g. accent background + bold). Keep a ref to the active span and `scrollIntoView({ block: "nearest" })` in an effect keyed on the active index.

**Selection & seek:**
- `onPointerDown` on a word: `e.preventDefault()`, close any open popup, set anchor = i, `sel = {lo:i, hi:i}`, `dragging = true`.
- `onPointerEnter` on a word while `dragging`: `sel = {lo:min(anchor,i), hi:max(anchor,i)}`.
- window `pointerup`: if `dragging`, finalize. If single word (`lo===hi`) → `onSeek(dwords[lo].ws)`. Open the popup anchored to the focus word (use the word span's bounding rect relative to a `position:relative` container; place above, or below if no room).
- Add `select-none` to the text container so native selection doesn't fight the drag.
- Close popup on `Esc` and on pointerdown outside the popup + outside any word.

**Popup toolbar (Highlight / Edit / Delete — NO Timing):**
- **Highlight** opens a small submenu: **Highlight 1** `#3BE477` (green), **Highlight 2** `#FFD63B` (yellow), **Font color** (`<input type="color">`), **Clear**. Applies to every word in the selection by writing `wordStyles[].color` (keyed by `src`); **Clear** removes `color` (and drops the entry if it has no `text`).
- **Edit** (enabled only when one word is selected): turn the word into an inline `<input>`; Enter/blur commits to `wordStyles[].text`; Esc cancels.
- **Delete / Restore** (toggle): if every selected word is currently `removed` → restore (drop overlapping `removed` ranges); else add `{start: ws, end: we}` for each selected word and `mergeRanges`. (This reuses the existing `removed` mechanism — delete = speech cut.)

All mutations go through `onUpdate(d => { ... })` (autosave + undo/redo handled by the hook).

### 3A.4 Wire playhead — `app/src/components/clip/editor/editor-shell.tsx`

Pass `playhead={playhead}` to `<TranscriptPanel .../>` (the shell already owns `playhead`).

### 3A.5 Live caption parity — `app/src/components/clip/editor/preview-canvas.tsx`

Replace the inline `windowedWords` builder with the styled helper so highlight colors reach the caption layer:
```ts
import { windowWords } from "@/lib/clip/edit-timeline";
const windowedWords = windowWords(edit, words);
```

### 3A.6 Caption render override — `app/src/components/clip/editor/caption-render.tsx`

Per-word color wins over base/active:
```ts
color: w.color ?? (active ? config.effects.highlightColor : config.font.color),
```

### 3A.7 Export parity — `app/src/lib/clip/editRender.ts` + `app/src/lib/clip/captions.ts`

- `editedWords(edit, words)` (in `editRender.ts`): apply `wordStyles` text + color while rebasing to edited time (same `1e-3` match), and include `color` on each emitted `Word`.
- `buildAssFromConfig` (in `captions.ts`): in the per-word map, if `w.color` is set use `inlineColor(rgb(w.color))` as that word's color (persistent — applies whether or not it's the active word); otherwise keep existing base/highlight behavior. `rgb()` and `inlineColor()` already exist in this file.

### 3A — Acceptance criteria
- Playing the clip live-highlights the current word in the transcript and auto-scrolls to keep it visible.
- Single-click a word → video + timeline playhead jump to that word's start.
- Click a word or drag across several → popup appears anchored to the selection.
- Highlight 1/2/Font color colors the word(s) in the transcript, in the live caption preview, and in the exported mp4.
- Edit changes a word's text in transcript + preview captions + export; Delete removes it (and the popup can restore it).
- `cd app && npm run build` passes; no console errors opening `/clip/[jobId]/[clipId]/edit`.

**STOP. Request Aamir's review of 3A before starting 3B.**

---

# SUB-PHASE 3B — Re-create the timeline as a real video editor (OpusClip parity)

**Goal:** **Throw out the current `timeline.tsx` behavior and rebuild it as a real, functional NLE-style timeline** that matches OpusClip (reference timeline images). It must do real editing — not a static visualization: a video **thumbnail filmstrip** that expands/collapses with zoom, an **audio waveform**, per-segment **Fill/Fit** framing chips, overlay/text tracks, and true editing gestures — **drag-select, split/cut, delete, drag cut-boundaries left/right, and trim the clip in/out**. Built with **shadcn/ui** for controls.

### 3B.0 — READ FIRST: how the timeline must behave (do the research)

Aamir's #1 complaint: *"my timeline is not behaving how it should — it should cut the video and the cut clip should drag left and right; I want to perform normal video editing on the timeline."* So before coding:

1. **Research a basic NLE timeline.** Understand the standard mental model used by CapCut / Premiere / OpusClip's clip editor: a horizontal time ruler; a **video track** rendered as a filmstrip; a **playhead** you scrub; **segments** created by **splitting** at the playhead; each segment is **selectable**, its **edges drag to re-time the cut** (the boundary between two segments moves), a segment can be **deleted** (footage removed, rest closes the gap), and the **whole clip trims** by dragging its outer left/right handles (in/out points). Zoom changes pixels-per-second so the filmstrip and waveform stretch.
2. **Pick the data model and keep the spine.** This editor is **linear** (like OpusClip — no out-of-order clip reordering). Implement real editing on top of the existing `ClipEdit` schema so preview + export stay pure functions of it:
   - **Cuts / delete footage** → `removed` ranges (collapsed by `keptSegments`).
   - **Split for framing** → a `layout` segment boundary at the split time; each segment carries its own `mode` (Fill/Fit) + `crop`.
   - **Cut-boundary drag (left/right)** → move the shared edge: update the adjacent `layout` segment ends (and, when the boundary is a delete edge, the `removed` range endpoint) — convert px→sec via `pxPerSec`, edited→window via `editedToWindow`.
   - **Trim clip in/out** → adjust `sourceInSec` / `sourceOutSec`.
   - Do **not** introduce free reordering or gaps unless a later phase asks; if a richer model is truly needed, raise it before building.
3. **Use shadcn/ui** for the surrounding chrome: `Button`, `Slider` (zoom), `DropdownMenu`/`ContextMenu` (right-click segment actions: Split, Delete, Fill/Fit, Crop), `Tooltip`, `Toggle`. The **track surface, filmstrip, waveform, playhead, drag handles and marquee** are custom (shadcn has no timeline primitive) — build them as clean, square-cornered DOM with pointer-event handlers. **No rounded corners on the video/segment layers** (Aamir asked for this on the preview; apply the same flat styling to timeline segment blocks so it reads like a real editor).
4. **Everything must actually work** — splitting, dragging a boundary, deleting, trimming, and zooming must change `ClipEdit` and be reflected live in the preview and in export. No placeholder/disabled gestures for the core editing actions.
5. **Use your developer/engineering skills (and any relevant skills/plugins) for this** — Aamir's explicit request. Treat the timeline as real software engineering, not a mockup: study a proven open-source video-editing timeline for patterns (e.g. how filmstrip rendering, pixel↔time mapping, drag/trim/snap, and playhead sync are implemented), invoke any installed Skills that help with frontend/video/timeline work, factor state cleanly (a `useTimeline` hook + small components), handle edge cases (zero-length segments, overlapping drags, boundary clamps, zoom limits), and keep it performant on long clips (virtualize/throttle the filmstrip + waveform if needed). If a small, well-maintained timeline/interaction library would meaningfully help, propose it before adding it.

### 3B.1 Server — video thumbnail filmstrip

> **Serving note:** existing asset serving (`/api/clip/asset/[clipId]/[name]`) is keyed by `clipId`, but the filmstrip is **job-level**. So the filmstrip route serves its own file(s) directly from disk (don't try to reuse the clipId asset route). Use a **single horizontal sprite sheet** (one image) rather than N frame requests — the timeline slices it with CSS `background-position`.

New lib `app/src/lib/clip/filmstrip.ts`:
- `ensureFilmstrip(jobId, fps=1, thumbH=48): { spritePath: string; frameCount: number; frameW: number; frameH: number; intervalSec: number }` — one ffmpeg pass over the source: `-vf fps=${fps},scale=-1:${thumbH},tile=${frameCount}x1` → a single sprite jpg saved next to the source (e.g. `os.tmpdir()/social-clipper/{jobId}/filmstrip.jpg`) or a job assets dir. Cache: skip if the sprite already exists. (`frameCount ≈ ceil(sourceDurationSec * fps)`; clamp tile count to a sane max like 600 and lower `fps` if needed.)
- Keep it cheap: `fps=1` (one thumb/sec); the UI stretches/repeats columns across zoom.

New route `app/src/app/api/clip/[jobId]/filmstrip/route.ts`:
- `GET → image/jpeg` streaming the sprite, **or** `GET?meta=1 → { frameCount, frameW, frameH, intervalSec, sourceDurationSec }`. The timeline fetches meta once, then sets the sprite as a CSS background and offsets per column.

### 3B.2 Server — audio waveform peaks

New lib `app/src/lib/clip/waveform.ts`:
- `ensureWaveform(jobId, buckets=1200): number[]` — decode source audio to mono PCM via ffmpeg (`-ac 1 -ar 8000 -f s16le -`), read the stream, reduce to `buckets` normalized peak amplitudes (0–1). Cache JSON job-level (e.g. `os.tmpdir()/social-clipper/{jobId}/waveform.json`); the route reads/serves it directly (job-level, so don't use the clipId-keyed asset helper).
- **Note on wording:** Aamir said "pitch high/low" — implement the standard **amplitude envelope** (loud/quiet bars) shown in the reference, not literal pitch (F0). Document this in a code comment.

New route `app/src/app/api/clip/[jobId]/waveform/route.ts`: `GET → { peaks: number[] }`.

### 3B.3 Timeline rebuild — `app/src/components/clip/editor/timeline.tsx` (rebuild from scratch)

Rebuild the component to the §3B.0 model. Suggested structure: a `useTimeline` hook (selection, drag state, px↔sec), a custom track surface, and shadcn controls. Tracks, top→bottom, matching the reference:

- **Ruler + playhead:** time ticks scaled by `pxPerSec`; click/drag to scrub; draggable playhead head. Keep `Ctrl/⌘+wheel` zoom and add a shadcn `Slider` for zoom.
- **Caption track:** a single block labeled with the active preset (e.g. "Beasty"), spanning the clip.
- **OVERLAYS track:** chips for `textOverlays` (green chip showing text like "From Gym Floor to $…"), `mediaOverlays`, `broll`, each draggable + edge-trimmable (reuse the prior `startSegDrag`/`startTrim` math).
- **Framing track (Fill/Fit chips):** one chip per `edit.layout` segment, label `Fill`/`Fit` (`Fill ·cropped` when `crop` set), positioned `start*pxPerSec`..`end*pxPerSec` (edited coords), **square corners**. Click selects the segment; the chip (or right-click menu) toggles `mode`; this is the surface for 3C's auto result and per-segment crop.
- **VIDEO track (filmstrip):** the source thumbnails, **flat/square** (no rounded corners). Frame width = `intervalSec * pxPerSec` so frames **expand/collapse with zoom**. Map on-screen frames to edited time by stepping `intervalSec` and resolving the source frame via `editedToSource` (so `removed` footage isn't shown). Render segment boundaries as **vertical divider lines** on this track.
- **AUDIO track:** `peaks` drawn as vertical bars, scaled to `pxPerSec`.

**Real editing gestures (must actually mutate `ClipEdit` + reflect in preview/export):**
- **Scrub / select playhead:** click anywhere on ruler/tracks → seek.
- **Drag-select range:** marquee on the video track → `selection={start,end}` (edited coords), shown shaded; Delete removes it (`editedToWindow` each endpoint → push `removed` → `mergeRanges`).
- **Split at playhead** (shadcn `Button` "Split" + shortcut): insert a `layout` boundary at the playhead → two adjacent segments; the new segment **copies** the source segment's `mode`/`crop`.
- **Drag a cut boundary left/right:** the divider between two segments is draggable; on drag, move the shared edge (`layout[i].end` = `layout[i+1].start` = new time, clamped between neighbors) so the cut re-times — this is Aamir's "the cut clip drags left and right."
- **Select a segment → drag its body:** selecting a segment highlights it (flat border, no radius); dragging its **edges** trims that segment; **Delete** removes that segment's footage (`removed`) and closes the gap.
- **Trim whole clip in/out:** drag the outer left handle → `sourceInSec`; outer right handle → `sourceOutSec`; clamp `[0, sourceDuration]`; re-derive via helpers (mirror the "Extend a clip" mutation).
- **Transport toolbar** (shadcn `Button`s, match reference): **Split / Delete / Mute / Add**, plus play/skip and zoom slider. Mute toggles base audio via a new `ClipEdit.muteBase?: boolean` honored in `editRender` pass 2.
- **Right-click a segment** → shadcn `ContextMenu`: Split, Delete, Fill, Fit, Crop.

**Visual rule:** all segment/video/overlay blocks use **square corners** (no `rounded-*`) so the timeline reads like a real editor (matches the preview fix in 3C.1).

### 3B.4 Overlays default to 9:16 — `app/src/components/clip/editor/rail-panels.tsx` (+ shell `TextPanelInline`)

- When adding a **media/image/video** overlay (Media panel) or **B-roll**, default the box to the full 9:16 frame: `x:0, y:0, w:1, h:1` (or a centered 9:16-fit box), `start: playhead`, sensible `end`. B-roll already replaces the main video on its range (`BrollSegment`).
- Overlay **types to support:** text (exists), image, video (exists via `MediaOverlay.kind`), and **AI-generated image/video**. Add an "AI generate" source in the Media/B-roll panel that calls a generation endpoint and drops the result in as a `MediaOverlay`/`BrollSegment` (recommended model in §3C.4 applies to images; for video use the project's configured video generator). If live generation is not wired this pass, show the AI option **disabled ("soon")** rather than omitting it — but the upload + 9:16 defaulting must work.

### 3B — Acceptance criteria
- The timeline behaves like a real video editor: **split** at the playhead creates segments; **dragging a cut boundary left/right re-times the cut**; **selecting a segment** lets you trim its edges or delete it (footage closes up); **dragging the outer handles trims the whole clip in/out**.
- Video track shows real source thumbnails that **expand/collapse with zoom**; audio waveform renders; Fill/Fit chips show per segment and toggle.
- Drag-select a range → Delete cuts it. Transport Split/Delete/Mute/Add work; Mute silences base audio in export.
- All timeline segment/video/overlay blocks have **square corners** (no rounded layers).
- Built with **shadcn/ui** controls (Button, Slider, DropdownMenu/ContextMenu, Tooltip).
- Adding an image/video overlay defaults it to the 9:16 frame; AI option present (live or disabled-"soon").
- Every gesture mutates `ClipEdit` and is reflected live in preview **and** export; `npm run build` passes.

**STOP. Request Aamir's review of 3B before starting 3C.**

---

# SUB-PHASE 3C — Auto Fill/Fit + inline dotted crop frame + AI model

**Goal:** The dotted crop frame appears inline on the preview (images 5–7) and the clip auto-segments into Fill (speaker visible → 9:16 face crop) vs Fit (b-roll/text/no person → full frame), editable afterward. Export must honor per-segment mode + crop.

### 3C.1 Inline crop frame on the preview — `app/src/components/clip/editor/preview-canvas.tsx`

**Match OpusClip (target images), not Aamir's current rounded `Fill | Fit | Crop` pill (incorrect image).**
- When a **Fill** segment is active at the playhead, render an aspect-locked **square-cornered** selection box over the video (thin border + 4 round corner handles). **No `rounded-*` on the box/overlay layer** — this is the explicit "remove the round corner on the layer above the video" fix.
- Floating toolbar above the box styled like OpusClip: a **crop icon**, an **add-image icon**, and a chevron — **square corners**, compact. Keep `Fill`/`Fit` quick-toggles if useful, but flat (no pill). The **Crop** action **opens the modal** (§3C.1b).
- Dragging the box body moves the crop; corners scale it (aspect-locked). On change, write to the **active** `LayoutSegment.crop` via `layoutAt(edit, playhead)` (not just `layout[0]`). Reuse `crop-modal.tsx` math (`startMove`, `startResize`, `clampRect`, aspect-lock `k`).

### 3C.1b Crop modal — aspect-ratio dropdown — `app/src/components/clip/editor/crop-modal.tsx`

Bring the modal to OpusClip parity (target images 2 & 4):
- Add an **Aspect ratio dropdown** (shadcn `Select`/`DropdownMenu`): `Custom`, `Original`, `9:16`, `1:1`, `16:9`, `4:3`, `9:8`, `4:5`.
  - A fixed ratio (`9:16`, `1:1`, …) **aspect-locks** the crop rect to that ratio (recompute the lock constant `k` from the selected ratio instead of always the output aspect).
  - `Custom` → **free-form** rect (no aspect lock).
  - `Original` → lock to the source's native aspect.
- Persist the chosen ratio so re-opening restores it. If the chosen crop ratio ≠ the clip's output ratio, that segment renders **Fit** (letterboxed) using the cropped region; otherwise **Fill**. (Consider adding `LayoutSegment.cropAspect?: string` if needed to remember the choice — keep export/preview in parity.)
- Add the OpusClip note line: *"To accommodate multiple speakers, please enable multiple speaker layouts (split, three, four)."* with an **`Enable layout`** link rendered **disabled ("soon")** (multi-speaker split layouts are out of scope this phase).
- Keep `Reset` / `Apply` and the existing `Auto Face Crop` button. The modal remains the **default** entry for framing the speaker.

### 3C.2 Per-segment reframe in export — `app/src/lib/clip/editRender.ts`

Currently pass 1 reads `edit.layout[0]` only. Change it to reframe **per layout segment**:
- For each kept segment from `keptSegments(edit)`, intersect it with `edit.layout` segments (edited coords). For each piece, build the `reframe` filter from that layout segment's `mode`/`crop` (reuse the existing fit/crop/cover branch logic). Emit one `trim+reframe` part per piece and `concat` them all (extend the existing `parts/labels/concat` builder to iterate pieces instead of whole kept segments).
- Preview already switches framing via `layoutAt` + the inline frame, so this brings export to parity.

### 3C.3 Auto-reframe detection — new `app/src/lib/clip/autoframe.ts` + route

- `autoFrameSegments(jobId, sourceInSec, sourceOutSec, aspect): Promise<LayoutSegment[]>`:
  1. Sample frames across `[sourceInSec, sourceOutSec]` at ~1 fps (reuse the frame-extraction approach in `face-crop.ts`).
  2. For each sample, classify **speaker present?** and get face center `(cx,cy)`.
  3. Build a segment list in **edited-timeline coords**: contiguous "speaker present" runs → `mode:"fill"` with a face-centered `crop` (reuse `buildCropRect` from `face-crop.ts`); "no speaker" runs (b-roll, text cards, wide graphics) → `mode:"fit"`. Merge adjacent same-mode runs; drop sub-~0.5s flickers. Optionally snap boundaries to scene cuts via ffmpeg `select='gt(scene,0.4)'`.
- New route `app/src/app/api/clip/[jobId]/[clipId]/autoframe/route.ts`: `POST {aspect} → { layout: LayoutSegment[] }`.
- **Editor shell:** replace the disabled "Tracker: soon" affordance with an **Auto reframe** button that calls the route and sets `edit.layout` (one `update`). After it runs, the 3B Fill/Fit chips + 3C.1 inline frame let the user override any segment. (Keep the global Fill/Fit buttons as a "set all" convenience.)

### 3C.4 AI model recommendation (Aamir asked: "best AI model to analyse fast")

State this in code comments + the panel tooltip. Recommendation, fastest→richest:

1. **Default — Google Gemini 2.0 Flash (or 2.5 Flash) on a single montage.** Tile the sampled frames into ONE contact-sheet image and send a single multimodal request asking, per tile, `{speaker: bool, cx, cy}`. One API call for the whole clip = fast + cheap, and the repo already uses Gemini for video analysis (`app/src/lib/gemini.ts`), so credentials/patterns exist. **Use this as the default.**
2. **Fastest / zero-cost — local face detector.** A lightweight on-box detector (e.g. MediaPipe Face Detection, `@vladmandic/face-api`, or OpenCV DNN) run over sampled frames. No API latency or spend; best if many clips are processed. Heavier to set up (native/wasm deps).
3. **Already-present fallback — GPT-4o vision per frame** (`face-crop.ts` `detectFaceCenter`). Works today but one call per frame is the slowest/most expensive; keep only as a fallback.

Implement #1 by default, structured so the detector is swappable (an interface `classifyFrames(frames): {speaker,cx,cy}[]`), with #3 as the fallback path if `GEMINI_API_KEY` is absent.

### 3C — Acceptance criteria
- **Auto reframe** segments the clip into Fill/Fit; timeline shows the alternating chips (image 4) and the preview switches framing as the playhead crosses segments — Fit shows the full b-roll/text frame (image 6), Fill shows the 9:16 speaker crop (image 7).
- The inline dotted frame edits the **active** segment's crop; the modal still works as default.
- Export reproduces per-segment framing exactly (preview/export parity).
- `npm run build` passes.

**STOP. Final review with Aamir.**

---

## 4. Files summary

### New files
| File | Purpose | Sub-phase |
| --- | --- | --- |
| `app/src/lib/clip/filmstrip.ts` | Extract/cache video thumbnail frames | 3B |
| `app/src/app/api/clip/[jobId]/filmstrip/route.ts` | Serve filmstrip frames + interval | 3B |
| `app/src/lib/clip/waveform.ts` | Decode/cache audio peak amplitudes | 3B |
| `app/src/app/api/clip/[jobId]/waveform/route.ts` | Serve waveform peaks | 3B |
| `app/src/lib/clip/autoframe.ts` | AI Fill/Fit segmentation | 3C |
| `app/src/app/api/clip/[jobId]/[clipId]/autoframe/route.ts` | Auto-reframe endpoint | 3C |

### Modified files
| File | Changes | Sub-phase |
| --- | --- | --- |
| `app/src/lib/types.ts` | `WordStyle`; `Word.color?`; `ClipEdit.wordStyles?` (+ optional `muteBase?`) | 3A (3B) |
| `app/src/lib/clip/edit-timeline.ts` | `windowWords` applies `wordStyles` + carries `color` | 3A |
| `app/src/components/clip/editor/transcript-panel.tsx` | Live highlight, click-seek, drag-select, popup (Highlight/Edit/Delete), `playhead` prop | 3A |
| `app/src/components/clip/editor/editor-shell.tsx` | Pass `playhead` to transcript; **Auto reframe** button; per-segment Fill/Fit | 3A, 3C |
| `app/src/components/clip/editor/preview-canvas.tsx` | Use styled `windowWords`; inline **square-cornered** crop frame on active segment (no rounded layer) | 3A, 3C |
| `app/src/components/clip/editor/crop-modal.tsx` | Aspect-ratio dropdown (Custom/Original/9:16/1:1/16:9/4:3/9:8/4:5); `Enable layout` "soon" note | 3C |
| `app/src/components/clip/editor/caption-render.tsx` | Per-word `color` override | 3A |
| `app/src/lib/clip/captions.ts` | `buildAssFromConfig` honors per-word `color` | 3A |
| `app/src/lib/clip/editRender.ts` | `editedWords` carries text+color; **per-segment** reframe in pass 1 | 3A, 3C |
| `app/src/lib/clip/store.ts` | `getDefaultEdit` seeds `wordStyles: []` | 3A |
| `app/src/components/clip/editor/timeline.tsx` (+ optional `use-timeline.ts`) | **Full rebuild as a real NLE timeline** (shadcn controls): filmstrip + waveform, Fill/Fit chips, split/cut/delete, **drag cut-boundaries left/right**, trim in/out, square corners | 3B |
| `app/src/components/clip/editor/rail-panels.tsx` | Overlays default to 9:16; AI image/video source | 3B |

---

## 5. Validation checklist (run before each STOP)

- [ ] `cd app && npm run build` compiles with no type errors.
- [ ] Opening `/clip/[jobId]/[clipId]/edit` shows no console errors.
- [ ] **Parity check:** export a clip, scrub the preview to the same time, confirm captions (colors/edits) and framing match the exported mp4 frame.
- [ ] Undo/redo still works for every new mutation (all writes go through `useClipEdit.update`).
- [ ] Autosave persists new fields (reload the page → `wordStyles`/`layout`/crop survive).
- [ ] Existing clips without the new fields still load (every reader guards with `?? []`/`?? default`).

## 6. Success criteria

1. Transcript behaves like OpusClip's Script tab: live word highlight, click-to-seek, and a Highlight/Edit/Delete popup whose effects reach the exported video.
2. Timeline is a **real, functional NLE rebuilt from scratch** (shadcn controls, square corners): filmstrip that scales with zoom, audio waveform, per-segment Fill/Fit chips, and **working** split / cut / delete, **draggable cut-boundaries**, and trim in/out.
3. Overlays (text/image/video/AI) sit on top of the video defaulting to the 9:16 frame.
4. The dotted crop frame is editable inline (modal kept as default), and Auto reframe segments the clip Fill/Fit via a fast AI model — fully editable afterward — with export honoring per-segment framing.

## 7. Notes

- **Check the attached reference images in Claude Code before each sub-phase** — Aamir attaches all OpusClip screenshots there; they are the visual source of truth and override the text if they differ (see the callout at the top, and the per-image map).
- **Timeline (3B) must be rebuilt from scratch as a real video editor** — Aamir's current timeline is non-functional. Use your developer/engineering skills + relevant Skills/plugins, research how a basic NLE timeline behaves, build with shadcn/ui, and make cuts/segments/drag/trim genuinely work (see §3B.0).
- **Crop:** inline frame + toolbar must be **square-cornered** (no rounded layer over the video); **Crop opens the modal** with the aspect-ratio dropdown (§3C.1b).
- Respect the review gate: do not advance sub-phases without Aamir's sign-off.
- Maintain caption parity across `caption-render.tsx`, `caption-styles.ts`, and `captions.ts` for any new caption-affecting field.
- After 3C, update `CLAUDE.md` (Clip Editor section) to document `wordStyles`, the filmstrip/waveform/autoframe endpoints, and per-segment reframe.
