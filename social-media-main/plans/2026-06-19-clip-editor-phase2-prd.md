# PRD — Phase 2: Timeline-Based Clip Editor

**Created:** 2026-06-19
**Status:** Ready for implementation
**Target executor:** Claude Code (Opus 4.8)
**Builds on:** `plans/2026-06-19-clipping-feature-prd.md` (Phase 0–8 clipping pipeline, already implemented).
**Replaces:** the stub at `app/src/app/clip/[jobId]/[clipId]/edit/page.tsx`.

> **Reference images:** Aamir will attach 12 screenshots of the OpusClip editor. This doc maps each feature to its image number:
> 1. Full editor (transcript + Speech cleanup, preview canvas with crop handles + hook, right rail, Layout/Tracker controls, timeline).
> 2. Caption preset gallery (Quick presets / My templates + aspect ratio).
> 3. Timeline with multiple **Fill/Fit** segments + a text-overlay chip (multi-speaker).
> 4. Timeline detail — text segment chip, Fill segments, audio waveform.
> 5. Right rail icons: AI enhance, Captions, Media, Brand template, B-Roll, Transitions, Text, Audio + zoom.
> 6. Captions → **Presets** tab.
> 7. Captions → **Font** tab (family, size, color, uppercase, stroke, shadow).
> 8. Captions → **Effects** tab (position, animation, lines, highlighted-word color, word background).
> 9. **Media** panel (drag/upload, save to cloud, All/Images/Videos/Audio).
> 10. **B-Roll** panel (Upload + auto-generate options).
> 11. **Transitions** panel (Auto toggle; Cross fade, Cross zoom, Zoom in, Zoom out).
> 12. **Audio** panel (Music / AI sound effects, Upload, search, Instrumental/etc.).

---

## 0. Pre-flight (do this first)

1. **Verify the build compiles.** In the current working tree, the clip domain types (`ClipJob`, `Clip`, `Word`, `Moment`, `ClipProgress`) are imported from `@/lib/types` but may be missing there. Run `npm run build` in `app/`. If it fails on missing clip types, restore/add them to `lib/types.ts` before starting Phase 2 — everything below extends those interfaces.
2. Confirm a clip renders end-to-end (New Clip → results grid) so there's a real `Clip` + source video to edit.

---

## 1. Goal & Scope

**Goal:** Replace the "coming soon" edit stub with a real, browser-based timeline editor (image 1) where the user can refine a generated clip — clean up speech, control the speaker crop (Fill/Fit + Tracker), restyle captions, drag captions/overlays, add media/B-roll/transitions/audio — preview it live, and **Export** a final rendered mp4.

**In scope for Phase 2 (exactly what Aamir specified):**
- Timeline editor shell with multi-track timeline, playhead, zoom, transport, and the toolbar actions in image 1.
- Live preview canvas that composites video + crop + captions + overlays in the browser.
- Transcript panel + **Speech cleanup** (word-level removal of fillers/silences).
- **Dynamic caption system**: preset gallery with **hover-preview** (image 2/6), Font tab (image 7), Effects tab (image 8); captions must be **bold, colorful, eye-catching**; user can **drag the caption block to reposition** it on the canvas/timeline.
- **Fill/Fit speaker framing** (images 3/4): per-segment layout, Tracker ON/OFF, manual crop; multi-speaker → one segment per speaker.
- Right-rail panels, step by step (image 5): **Captions** (preset/font/effects), **Media** (overlay upload, shows on timeline), **B-Roll** (upload button only), **Transitions** (incl. fade-in/out + cross fade/zoom/zoom-in/zoom-out), **Audio** (SFX, music, trending music, self-upload).
- **Export** → final mp4 saved to the clip's media dir, replacing/duplicating the original.

**Deferred (stub or hide the icon, not Phase 2):** AI enhance, Brand template, B-Roll auto-generate/stock/prompt (image 10 — upload only this phase), "Save to cloud" backend, AI sound effects generation (list/upload only).

---

## 2. The spine: one Edit Document drives preview AND export

**The single most important architectural rule:** all edits are stored in one JSON document (`ClipEdit`), and **both** the browser preview **and** the server-side ffmpeg export are pure functions of that document. If they ever diverge, the editor is useless. Build the preview compositor and the ffmpeg compiler against the same `ClipEdit` schema, and add a visual parity check (export a frame, compare to preview) in testing.

- **Storage:** `data/clip-edits/{clipId}.json`, loaded/saved via new helpers in `lib/clip/store.ts` (`readEdit(clipId)`, `writeEdit(clipId, edit)`). Auto-save on change (debounced) + explicit **Save changes** button (image 1).
- **Source of truth for media:** the original source video for the job (`tmpRoot()/{jobId}/source.mp4`). Because the editor needs the *full* source (e.g. "Extend a clip" pulls beyond the original in/out), ensure the source video is retained for editable jobs (don't delete the temp dir for jobs with edits; see §11).

### 2.1 `ClipEdit` schema (add to `lib/types.ts`)

```ts
export interface CropRect { x: number; y: number; w: number; h: number; } // in source px

export interface LayoutSegment {        // images 3,4 — Fill/Fit per time range / speaker
  id: string;
  start: number; end: number;           // clip-local seconds
  mode: "fill" | "fit";                 // fill = cover-crop (zoom to speaker); fit = whole frame, letterboxed
  speakerId?: string;                   // when Tracker produced it
  crop?: CropRect;                       // manual or tracked crop (fill mode)
}

export interface CaptionConfig {
  enabled: boolean;
  preset: string;                        // "Karaoke" | ... | "No caption"
  font: {
    family: string;                      // image 7: Roboto, Montserrat, etc.
    sizePx: number;
    color: string;                       // base word color
    uppercase: boolean;
    strokeColor: string; strokeWidthPx: number;
    shadow: boolean;
    italic?: boolean; underline?: boolean;
  };
  effects: {
    position: "auto" | "top" | "middle" | "bottom"; // image 8
    animation: "none" | "box" | "pop" | "bounce" | "karaoke"; // image 8 "Box" etc.
    lines: 1 | 3;
    highlightColor: string;              // active spoken word
    wordBgColor?: string;                // optional word background
  };
  offset?: { x: number; y: number };     // drag-to-reposition (overrides position)
}

export interface TextOverlay {           // green hook chip "From Gym Floor…", titles
  id: string; text: string;
  start: number; end: number;
  x: number; y: number;                  // normalized 0–1 on canvas
  style: { bg?: string; color: string; sizePx: number; bold: boolean; radiusPx: number };
}

export interface MediaOverlay {          // image 9 — uploaded image/video on screen
  id: string; kind: "image" | "video";
  src: string;                           // path under the clip's assets dir
  start: number; end: number;
  x: number; y: number; w: number; h: number; // normalized 0–1
  z: number; opacity?: number;
}

export interface BrollSegment {          // image 10 — upload only this phase
  id: string; src: string;
  start: number; end: number;            // replaces main video on this range
  mode: "fill" | "fit";
}

export interface TransitionMarker {      // image 11
  id: string; atTime: number;
  type: "fade" | "crossfade" | "crosszoom" | "zoomin" | "zoomout";
  durationSec: number;                   // fade includes fade-in (at 0) / fade-out (at end)
}

export interface AudioTrack {            // image 12
  id: string; kind: "music" | "sfx" | "upload";
  src: string; label?: string;
  start: number; end: number;
  gain: number;                          // 0–1
  fadeInSec?: number; fadeOutSec?: number;
  duckUnderSpeech?: boolean;             // suggestion (§9)
}

export interface RemovedRange { start: number; end: number; } // speech cleanup cuts (clip-local)

export interface ClipEdit {
  clipId: string; jobId: string;
  aspectRatio: string;                   // "9:16" | "1:1" | "16:9"
  durationSec: number;                   // edited duration (after removals)
  sourceInSec: number; sourceOutSec: number; // window into source.mp4 ("Extend a clip" widens this)
  layout: LayoutSegment[];
  tracker: boolean;                      // Tracker ON/OFF (image 1)
  caption: CaptionConfig;
  removed: RemovedRange[];               // speech cleanup
  textOverlays: TextOverlay[];
  mediaOverlays: MediaOverlay[];
  broll: BrollSegment[];
  transitions: TransitionMarker[];
  autoTransitions: boolean;
  audio: AudioTrack[];
  updatedAt: string;
}
```

`getDefaultEdit(clip)` seeds this from the existing `Clip` (caption from `clip` preset, one full-length `fill` layout segment, the auto-hook as a `TextOverlay`, transcript words from the job).

---

## 3. Page & layout (image 1)

Rebuild `app/src/app/clip/[jobId]/[clipId]/edit/page.tsx` as the editor. Layout regions:

- **Top bar:** back arrow, clip title, undo/redo, keyboard-shortcuts hint, **Save changes**, **Export** (primary), credit indicator.
- **Left column:** **Speech cleanup** button + scrollable **transcript** (word-level, gaps shown as `0.38s` chips like image 1) + **Extend a clip**.
- **Top-center status row:** aspect ratio (`9:16`), **Layout: Fill/Fit**, **Tracker: ON/OFF** toggles (image 1).
- **Center preview canvas:** the composited 9:16 frame with crop handles + draggable caption/overlay boxes.
- **Right rail:** icon buttons (Captions, Media, B-Roll, Transitions, Text, Audio) opening a floating panel (images 5–12). AI enhance / Brand template icons shown but disabled (tooltip "coming soon").
- **Bottom timeline:** transport (skip-back, play/pause, skip-fwd), time `00:00.00 / 01:37.17`, Hide timeline, split, delete, mute, add; zoom slider; multi-track lanes; `+` add buttons at both ends.

Suggested component split under `app/src/components/clip/editor/`: `EditorShell`, `PreviewCanvas`, `TranscriptPanel`, `Timeline` (+ `TimelineTrack`, `TimelineSegment`), `RightRail`, and one panel per right-rail tab (`CaptionsPanel`, `MediaPanel`, `BrollPanel`, `TransitionsPanel`, `AudioPanel`). A single `useClipEdit(clipId)` hook owns the `ClipEdit` state + autosave + undo/redo stack.

---

## 4. Preview engine (browser)

A `PreviewCanvas` that renders the current `ClipEdit` at the playhead. Recommended approach: a fixed-aspect container (e.g. 1080×1920 scaled to fit) with layered absolutely-positioned elements:

1. **Base video** — a single `<video>` of `source.mp4`, seeked to `sourceInSec + playheadLocal` (accounting for `removed` ranges, see §5). The active `LayoutSegment` applies a CSS `transform: scale()/translate()` (or `object-fit: cover` with crop) to emulate Fill cover-crop vs Fit letterbox.
2. **B-roll layer** — when a `BrollSegment` covers the playhead, show its media instead of/over the base video.
3. **Media overlays** — positioned/resizable boxes for images/videos (drag + corner-resize handles).
4. **Caption layer** — render the current word group from the transcript with the active word highlighted, styled from `CaptionConfig` (font, color, stroke, uppercase, animation). Draggable to set `caption.offset`.
5. **Text overlays** — the hook chip + titles, draggable.

Transport: a `requestAnimationFrame` loop advances a clip-local playhead, maps it through `removed` ranges to a source time, and `video.currentTime = …`. Play/pause/seek wired to timeline + spacebar.

**Hover-preview for caption presets (image 2/6):** each preset tile renders a tiny live sample ("TO GET STARTED") using the same caption renderer so hovering shows exactly how that style animates/colors. Reuse `CAPTION_STYLES` from `lib/clip/caption-styles.ts` (extend it with font + animation descriptors to match the new `CaptionConfig`).

---

## 5. Transcript + Speech cleanup (image 1 left)

- Render the clip's words (from the job transcript, sliced to `[sourceInSec, sourceOutSec]`) as clickable tokens; inter-word gaps ≥ ~0.3s show a duration chip (`0.45s`).
- **Click a word** → toggle it into `removed` (struck-through); clicking a gap chip can remove the silence. Removing words updates `durationSec` and the playhead↔source mapping (the export concats only kept ranges).
- **Speech cleanup** button → auto-detect filler words (`um, uh, like, you know, …`) and long silences (> X s) and propose them as removals the user can accept/reject. This directly closes the "no filler/silence trimming" gap from the Phase 8 audit.
- **Extend a clip** → widen `sourceInSec/sourceOutSec` by pulling adjacent source content (re-slice transcript accordingly).

---

## 6. Fill / Fit speaker framing + Tracker (images 1, 3, 4)

- **Layout track** on the timeline holds `LayoutSegment[]`. Each segment shows a `Fill` or `Fit` label (image 3/4). Selecting a segment lets the user (a) toggle Fill/Fit, (b) drag/resize the crop box on the preview (Fill mode).
- **`Layout: Fill/Fit`** top control sets the default for the whole clip / selected segment.
- **`Tracker: ON`** → auto-generate one `LayoutSegment` per speaker turn, each cropped to the active speaker (multi-speaker podcast → alternating segments, image 3). **Tracker: OFF** → a single full-length segment with one manual crop (image 4, "Tracker OFF").
- **Phase 2 scope decision:** the *manual* Fill/Fit + crop UI and the data model are fully in Phase 2. **Automatic** speaker detection that populates tracked crops is the large "speaker-aware reframe" engine from the audit — wire the **Tracker toggle + segment model now**, and implement auto-population behind a clear interface (`detectSpeakerSegments(source, range) → LayoutSegment[]`) that can start as face-centred heuristic and be upgraded later. Don't block the editor on perfect tracking.

---

## 7. Right-rail panels (image 5 → 6–12), step by step

### 7.1 Captions (images 6, 7, 8)
Tabs: **Presets / Font / Effects** (mirror image layout).
- **Presets (6):** the gallery (No caption, Beasty, Youshaei, Mozi, Glitch Infinite, Karaoke, Deep Diver, Pod P, Popline, Seamless Bounce) + "My templates" (save current `CaptionConfig` as a named template in `data/caption-templates.json`). Each tile = live hover-preview (§4).
- **Font (7):** family dropdown (bundle real fonts — see §10), size px, color, uppercase toggle, italic/underline, **font stroke** (color + px), **font shadows** toggle.
- **Effects (8):** Position (Auto/Top/Middle/Bottom), Animation dropdown (Box, Pop, Bounce, Karaoke…), Lines (One/Three), Highlighted-word color, Word background color.
- All edits write to `caption` and re-render preview instantly.

### 7.2 Media (image 9)
- Drag-and-drop / click upload of image/video → saved under `data/clips/assets/{clipId}/…`, added as a `MediaOverlay` and shown as a new **overlay track segment** on the timeline. Draggable/resizable on the canvas. Tabs All/Images/Videos/Audio filter uploaded assets. ("Save to cloud" shown, disabled/deferred.)

### 7.3 B-Roll (image 10) — **upload only this phase**
- A single **Upload** button → adds a `BrollSegment` (video/image) over the selected timeline range (replaces main video for that range). Hide/disable Auto-generate AI / stock / Prompt B-roll for now (note them as later phases).

### 7.4 Transitions (image 11)
- **Auto transitions** toggle (`autoTransitions`) → inserts a default transition at each cut/segment boundary.
- **Custom transitions:** Cross fade, Cross zoom, Zoom in, Zoom out — plus **Fade in / Fade out** (Aamir's explicit ask) at clip start/end. Applied as `TransitionMarker`s; export maps them to ffmpeg `xfade`/`fade`/`zoompan`.

### 7.5 Audio (image 12)
- Tabs: **Music** and **SFX** (+ optionally "AI sound effects" label, generation deferred).
- **Library** of copyright-free music with a **Trending/Instrumental/etc.** filter and search; click `+` to add as an `AudioTrack`. **[HUMAN/asset]** Aamir provides a royalty-free music/SFX library (local files under `data/audio-library/` or a JSON manifest of URLs) — note this dependency.
- **Upload** your own audio → `AudioTrack(kind:"upload")`.
- Per-track gain, fade-in/out, position on a dedicated audio lane with waveform.

---

## 8. Export engine (server) — `lib/clip/editRender.ts`

New module that compiles a `ClipEdit` into a deterministic ffmpeg render reproducing the preview. New route `POST /api/clip/[jobId]/[clipId]/export` (SSE progress like the pipeline). Steps the compiler must handle:

1. **Speech cuts:** build the kept-ranges list from `removed`; trim+concat those source ranges (filter `select`/`trim`+`concat`, or segment-and-concat) to form the spine.
2. **Layout/crop per segment:** apply each `LayoutSegment`'s crop+scale to the target aspect (Fill = `crop`+`scale`; Fit = `scale`+`pad`). Time-varying crops via `sendcmd`/`zoompan` or per-segment render + concat.
3. **B-roll:** overlay/replace on its ranges.
4. **Media + text overlays:** `overlay` (and `drawtext`/`ass`) at the right x/y/time windows.
5. **Captions:** extend `lib/clip/captions.ts` `buildAssFile` to honor the new `CaptionConfig` (font family/size/color/stroke/shadow/uppercase, position, animation, highlight + word-bg). Animations via ASS `\t`/`\fscx,\fscy`/`\move`.
6. **Transitions:** `xfade`/`fade`/`zoompan` per `TransitionMarker`; `autoTransitions` inserts defaults.
7. **Audio mix:** `amix`/`adelay`/`volume`/`afade` for music+sfx+original, optional ducking.
8. Output mp4 → `data/clips/{clipId}-edited.mp4`; update the `Clip` (`updateClip`) so results/download/schedule use the edited version (keep the original too).

**Parity check (required test):** render one edit, grab a frame at time T via ffmpeg, and compare against the preview at T for the same `ClipEdit` — caption position, crop, and overlays should match.

---

## 9. My suggestions (additions worth including)

- **Undo/redo + autosave** on the `ClipEdit` (history stack in `useClipEdit`). Editors are unusable without undo.
- **Keyboard shortcuts:** space = play/pause, `[`/`]` = trim to playhead, `S` = split, `Del` = delete segment, arrows = nudge. (image 1 shows a shortcuts button.)
- **Snapping** of segments/overlays/transitions to cuts and the playhead; magnetic timeline so deleting a word/segment closes the gap.
- **Safe-area guides** on the canvas (TikTok/Reels UI overlap zones) so captions/overlays aren't hidden behind platform UI.
- **Music auto-duck** under speech (`duckUnderSpeech`) — big perceived-quality win, cheap with `sidechaincompress`.
- **Per-clip "Regenerate captions"** if the user edits transcript text (fix transcription errors → captions update).
- **Export presets** (resolution/bitrate; 1080p default, 4K optional) and a re-export without re-doing edits.
- **Reuse, don't fork, caption styling:** keep `captions.ts` (server ASS) and `caption-styles.ts` (client preview) as the two parity sources; every new field added to one must be added to the other.
- **Non-destructive:** never overwrite `source.mp4` or the original clip mp4; the edited output is a separate file.

---

## 10. [HUMAN] / asset dependencies
- **Fonts:** to make presets visually distinct (image 7 lists Roboto, and presets like Beasty/Mozi need specific display fonts), bundle a set of open-license fonts (e.g. from Google Fonts) under `app/assets/fonts/` and point libass `fontsdir` + the browser `@font-face` at them. **[HUMAN]** pick/approve the font set.
- **Audio library:** **[HUMAN]** supply royalty-free music + SFX (files or a manifest) for the Audio panel (image 12).
- No new API keys are required for Phase 2 (editing + export are local ffmpeg). Deferred AI features (AI enhance, AI B-roll, AI SFX) would add keys later.

---

## 11. Implementation sub-phases (execute in order)

- **2.0 — Edit model + persistence.** `ClipEdit` types, `getDefaultEdit`, `readEdit/writeEdit`, GET/PUT `/api/clip/[jobId]/[clipId]/edit`. Retain source video for editable jobs. *Done when:* opening the editor loads a default `ClipEdit` and autosaves changes.
- **2.1 — Editor shell + preview.** Layout regions (§3), `PreviewCanvas` rendering base video + one Fill segment + captions, transport + playhead. *Done when:* the clip plays in-canvas with live captions matching the chosen preset.
- **2.2 — Timeline.** Multi-track lanes (video/layout, caption, overlay, audio), zoom, segment select/trim/split/delete/drag, waveform, toolbar actions (images 1,3,4). *Done when:* timeline edits reflect in preview and `ClipEdit`.
- **2.3 — Captions panel.** Presets (hover-preview) / Font / Effects (images 6–8); drag-to-reposition on canvas. *Done when:* every control changes the live preview and persists.
- **2.4 — Speech cleanup + Extend.** Transcript panel, word/silence removal, filler auto-detect, extend in/out (§5). *Done when:* removing words shortens the preview and the eventual export.
- **2.5 — Fill/Fit + Tracker.** Layout segments, manual crop on canvas, Tracker toggle with `detectSpeakerSegments` interface (heuristic ok) (§6). *Done when:* Fill/Fit per segment renders correctly in preview.
- **2.6 — Media / B-Roll / Transitions / Audio panels** (§7.2–7.5). *Done when:* each adds the right element to the timeline + preview and persists.
- **2.7 — Export.** `editRender.ts` + SSE export route reproducing the preview; parity frame check (§8). *Done when:* Export produces an mp4 that matches the preview and updates the `Clip`.
- **2.8 — Polish.** Undo/redo, shortcuts, snapping, safe-area guides, error states; update `CLAUDE.md`. *Done when:* full edit→export loop is smooth and documented.

---

## 12. Definition of Done (Phase 2)
From the results grid, clicking **Edit** opens a working timeline editor. The user can clean up speech, set Fill/Fit framing per speaker, restyle captions (preset/font/effects) with live hover-previews and drag them into place, add media overlays / B-roll (upload) / transitions (incl. fade in/out) / audio (music, SFX, trending, upload), preview everything live, and **Export** a final mp4 that exactly matches the preview — all persisted per clip so reopening the editor restores the edit.
