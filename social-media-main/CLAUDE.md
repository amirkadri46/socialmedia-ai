# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Is

**Social Media AI** — a tool that helps create viral Instagram Reels by analyzing competitor content. It scrapes competitors' recent videos, identifies the most viral ones, analyzes them with AI (video understanding + content breakdown), and generates new adapted video concepts for a given brand.

---

## How to Run

```bash
cd app
npm install
npm run dev
# Open http://localhost:3000
```

**Required environment variables** (in `.env` at project root):
- `APIFY_API_TOKEN` — Apify Instagram scraper
- `GEMINI_API_KEY` — Google Gemini video analysis
- `OPENAI_API_KEY` — OpenAI concept generation

**Clipping feature extras** (most are set in `/settings`, not `.env`):
- `yt-dlp` on PATH (or `YT_DLP_PATH`) — required to ingest videos from a URL. The Upload path works without it. ffmpeg/ffprobe are bundled via `ffmpeg-static`/`ffprobe-static`.
- Transcription key — `deepgramApiKey` (recommended) or `assemblyaiApiKey`, set in Settings.
- Social publishing — `metaAppId`/`metaAppSecret`/`mediaPublicBaseUrl` + `enableSocialPublish` toggle in Settings. Live publishing is gated until a Meta app passes App Review (see `plans/2026-06-19-clipping-feature-prd.md` §2.4).

---

## Tech Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** components
- **CSV files** for data storage (in `data/` directory)
- **Apify** — Instagram scraping
- **Google Gemini 2.0 Flash** — Video analysis (upload + multimodal)
- **OpenAI GPT-4o** — New concept generation

---

## How The System Works

### Pipeline Overview

1. **Input** — Select a config and parameters (max videos, top-K, days lookback) via the Run page
2. **Load Config** — Retrieve analysis prompt, new concepts prompt, and creator list from CSV
3. **Scrape** — For each competitor creator, scrape recent Instagram Reels via Apify
4. **Filter & Rank** — Filter by date, sort by views, take top-K most viral
5. **Analyze** — Download video, upload to Gemini, analyze (extracts Concept, Hook, Retention, Reward, Script)
6. **Generate** — Send analysis + brand context to Claude for adapted video concepts
7. **Save** — Append results to `data/videos.csv`, viewable in the Videos page with thumbnails

### Two Customizable Prompts Per Config

- **Analysis Instruction** — How Gemini should break down the video
- **New Concepts Instruction** — How OpenAI should adapt the reference for the brand

### Outreach / Lead Intelligence (vertical: CSV → analyzed, scored, contactable leads)

Per `plans/2026-06-23-ai-lead-intelligence-system-prd.md`. The CSV → Prospect → Draft outreach flow is extended into a full **Lead Intelligence System** — Google-Maps-style local-business leads are analyzed, priority-scored, given multi-channel outreach drafts, and tracked through a CRM pipeline. **One rule: extend, do not duplicate.** There is a single `Prospect` model (`lib/types.ts`), a single email field (`emailMessage`), and a single list store (`data/outreach-lists.json` + `data/csv/`). The legacy LinkedIn import + `/api/outreach/draft` flow is unchanged.

```
Google Maps CSV → AI analysis (priorityScore + priorityLevel + businessCategory + reviewSummary + websiteStatus + outreachAngle)
               → AI personalization (whatsappMessage + emailMessage + coldCallNotes)
               → CRM pipeline (leadStatus, lastContactedAt, followUpDate) → filtering + dashboard
```

- **Scoring source of truth:** `lib/lead-scoring.ts` — `levelFromScore()` derives the level from the 0–100 score (the model never picks the bucket), plus `LEVEL_META`, `STATUS_META`, `LEAD_STATUS_LABELS`, `LEAD_STATUS_ORDER`, `PRIORITY_LEVELS`.
- **Shared LLM client:** `lib/llm-client.ts` (`buildLlmClient`, `parseJsonResponse`) factors the OpenAI/OpenRouter provider+model selection used by **both** `/api/outreach/draft` and `/api/outreach/analyze`.
- **Import:** `POST /api/outreach/import` adds Google Maps column aliases + a Maps preset (auto-detected via `detectedSource`). `POST /api/outreach/lists` seeds `source:"maps"`, `leadStatus:"new"`, `analysisStatus:"idle"` (`defaultLeadFields()` in `lib/outreach.ts`); `PATCH` exposes the lead fields in `WRITABLE_PROSPECT_FIELDS` and auto-stamps `lastContactedAt` on first move to `contacted`; `DELETE ?listId=&prospectId=` removes one lead.
- **Bulk processing:** `POST /api/outreach/analyze` (SSE) runs two phases — Phase 1 analyze+score, Phase 2 generate the three message assets — in batches of 3, persisting incrementally to `data/outreach-lists.json` after each batch. Each event is `{ phase: "analyzing"|"generating"|"done"|"error", completed, total, lastId, lead }`. Body takes `prospectIds?` (bulk-selection target), `regenerate?`, and `messagesOnly?` (skip Phase 1 — used by the "Create messages" bulk action). The SSE reader lives in the page so closing the progress dialog does not cancel the job.
- **Dashboard:** `GET /api/outreach/stats` aggregates all lists; `/outreach/dashboard` renders 9 stat cards + CSS/SVG priority-distribution + pipeline-funnel charts (no chart dependency).
- **UI:** built entirely from shadcn primitives in `components/outreach/` (`lead-table`, `lead-row`, `lead-detail-sheet`, `priority-badge`, `lead-status-select`, `filter-bar`, `analyze-progress-dialog`, `import-wizard`, `outreach-message-tabs`, `cold-call-card`, `stat-card`, `dashboard-charts`); state via `hooks/use-leads.ts` + `hooks/use-lead-filters.ts` (filters persist to `localStorage` per list id). `app/outreach/prospects/page.tsx` ("Leads" workspace) is a thin composition. `lead-table` uses **infinite scroll** (IntersectionObserver sentinel inside the ScrollArea grows a render window; no pagination) and a **row-selection** checkbox column (select-all in header) wired to a bulk-action bar in the page ("Analyze" = full re-run, "Create messages" = `messagesOnly`). `lead-row` has inline-editable **Price quoted** / **Price confirmed** (`priceQuoted`/`priceConfirmed` on `Prospect`) and a free-text **Note** column (reuses `customNotes`) — all persisted via the PATCH route. `templates/page.tsx` is built from `ui/card` + `ui/switch`. New primitives: `ui/avatar`, `ui/sonner` (Toaster mounted in `layout.tsx`); `ui/checkbox`/`ui/card`/`ui/switch` used by the leads/templates UI. Sidebar "Outreach" section → Dashboard / Leads / Templates.

### Clipping Pipeline (separate vertical: long video → viral clips)

A self-contained second pipeline under `lib/clip/` + `app/clip/` + `api/clip/`, mirroring the SSE/settings/CSV patterns of the analysis pipeline.

1. **Ingest** (`download.ts`) — `yt-dlp` downloads a URL (or an uploaded file is saved) to a temp dir.
2. **Transcribe** (`transcribe.ts`) — ffmpeg extracts audio; Deepgram/AssemblyAI returns word-level timestamps.
3. **Select moments** (`moments.ts`) — the configured LLM picks the top-K viral segments (honors genre, clip length, "include moments", timeframe), each scored 0–100.
4. **Render** (`render.ts`) — per moment, one frame-accurate ffmpeg pass: cover-crop reframe to 9:16/1:1/16:9, burn karaoke `.ass` captions (`captions.ts`) and the first-5s auto-hook.
5. **Persist & stream** (`clipPipeline.ts`, `api/clip`) — jobs → `data/clip-jobs.json`, clips → `data/clips.csv`, mp4s/thumbs → `data/clips/`. Progress streams over SSE; closing the modal keeps the job running and `/clip/[jobId]` polls until done.
6. **Schedule** (`social/instagram.ts`) — Meta OAuth connect + AI caption generation work now; live IG publishing is implemented but gated behind `enableSocialPublish` until Meta App Review.

**Scope note:** v1 ships center/face-anchored crop (not speaker-tracked reframe). The Edit-clip studio (Phase 2) is now built.

### Clip Editor (Phase 2: timeline editor)

Per `plans/2026-06-19-clip-editor-phase2-prd.md`. The single architectural rule: one **`ClipEdit`** JSON document (in `lib/types.ts`, stored at `data/clip-edits/{clipId}.json`) is the source of truth — **both** the browser preview **and** the ffmpeg export are pure functions of it (`lib/clip/edit-timeline.ts` holds the shared time math).

- **UI** under `app/src/components/clip/editor/`: `EditorShell` (transport, rail, export), `PreviewCanvas` (live composite; caption/text/media overlays are all drag-positionable, media corner-resizable), `crop-modal` (aspect-locked draggable crop frame → `LayoutSegment.crop`, honored identically in preview + export), `caption-render` (browser caption twin of the ASS), `CaptionsPanel` (Presets/Font/Effects), `text-overlay-settings` (per-overlay font/size/color/align/bg popup), `TranscriptPanel` (speech cleanup), `Timeline` (drag-scrub, Ctrl+wheel zoom, drag/trim segments), `rail-panels` (Media/B-Roll/Transitions/Audio), `useClipEdit` (state + debounced autosave + undo/redo). Note: preview video needs `maxWidth/maxHeight:none` to override Tailwind preflight's `video{max-width:100%}` when a crop scales it past 100%.
- **Persistence/transcripts:** the pipeline now saves word timings to `data/clip-transcripts/{jobId}.json` (the editor needs them). Editor uploads go to `data/clips/assets/{clipId}/`.
- **Export** (`lib/clip/editRender.ts`, `POST /api/clip/[jobId]/[clipId]/export` SSE): pass 1 = speech cuts + Fill/Fit reframe + transitions (`xfade`/`acrossfade` per boundary marker, plain `concat` for hard cuts) + audio; pass 2 = burn captions (`buildAssFromConfig`) + text overlays + mix uploaded audio → `data/clips/{clipId}-edited.mp4`, then `updateClip` points the clip at it. Media/B-roll compositing exists in preview + model; export support for those is a later increment.
- **Transitions** (fade/crossfade/crosszoom/zoomin/zoomout): `TransitionMarker[]` + `autoTransitions` on `ClipEdit`. `allTransitions(edit)` in `edit-timeline.ts` is the shared pure source (manual markers + auto-crossfades at layout/cut boundaries, manual wins within 0.3s) used by **both** the preview (CSS transform/opacity on the video box in `preview-canvas.tsx`, triangle progress over `[atTime±d/2]`) and the export (`editRender.ts` `xfadeMap`: fade→fadeblack, crossfade→dissolve, crosszoom/zoomin→zoomin, zoomout→fadewhite). `TransitionsPanel` (`rail-panels.tsx`) adds markers at the playhead with a per-marker duration slider (0.2–1.5s).
- **Caption parity:** `lib/clip/captions.ts` (server ASS) and `lib/clip/caption-styles.ts` (client preview) are the two parity sources — add any new caption field to both.

### Clip Editor (Phase 3: OpusClip-parity script/timeline/auto-reframe)

Per `plans/2026-06-21-clip-editor-phase3-opusclip-enhancements.md`. Extends Phase 2; same one-`ClipEdit` rule (preview + export stay pure functions of it).

- **3A — Script editor** (`transcript-panel.tsx`): live word highlight + auto-scroll as the clip plays, click-to-seek, drag-select, and a Highlight/Edit/Delete popup. Per-word overrides live in `ClipEdit.wordStyles` (`WordStyle{t,color,text}`, keyed by the word's source start). `windowWords` (preview) and `editedWords` (export) both apply them; per-word `color` reaches `caption-render.tsx` and `buildAssFromConfig`.
- **3B — Opus-style timeline** (`timeline.tsx`): video **filmstrip** track (a single sprite sheet from `lib/clip/filmstrip.ts`, served job-level by `GET /api/clip/[jobId]/filmstrip` — `?meta=1` for geometry, else the jpeg) that expands/collapses with zoom; **audio waveform** (amplitude envelope, `lib/clip/waveform.ts` → `GET /api/clip/[jobId]/waveform`); per-segment **Fill/Fit** chips; **drag-select → cut**, **split** at playhead, **trim** clip in/out by dragging the video-track ends. Transport toolbar adds split/delete/mute/add; `ClipEdit.muteBase` silences base audio in export. Overlays/B-roll default to the full 9:16 frame; live AI image/video generation is a disabled "soon" affordance. Editor keyboard shortcuts are configurable in Settings (`lib/clip/shortcuts.ts`, `editorShortcuts`).
- **3C — Auto Fill/Fit + auto-reframe**: **Auto reframe** button (`POST /api/clip/[jobId]/[clipId]/autoframe`) calls `lib/clip/autoframe.ts`, which samples ~1fps frames and classifies speaker-present (→ Fill, face-centered crop via `buildCropRect`) vs none (→ Fit). Default detector is **Gemini Flash on one tiled contact-sheet image** (single call); **GPT-4o per-frame** is the fallback when `GEMINI_API_KEY` is absent. Returns clip-local segments; the route maps them to edited coords.
- **3D — Multiple-speaker layouts** (per `plans/2026-06-21-clip-editor-phase3d-multi-speaker-layouts.md`): a `LayoutSegment` can stack **N face-crops of the same source** into tiled output slots — `kind: "single"|"split"|"triple"|"quad"` + `panes: SpeakerPane[]` (each pane a `crop`). Slot geometry in `layout-geom.ts` (`paneCount`/`splitSlots` — 2/3 stacked rows, quad = 2×2 grid — `slotAspect`); each pane crop is built to its slot's pixel aspect (`buildCropRectForAspect` in `face-crop.ts`) so the slot is fully covered (no bars). The **preview** (`preview-canvas.tsx`) composites **one** decoded `<video>` into the N slots on a `<canvas>` (one decode → smooth, perfectly synced — not N stuttering `<video>` elements); transparent per-slot handles edit each pane (drag = pan its crop, selected slot's corner = zoom); a **Layout** selector (toolbar + crop modal's now-functional **"Enable layout"** note) switches kind and seeds panes via detection. **Detection**: `detectSpeakerPanes` in `autoframe.ts` (`POST /api/clip/[jobId]/[clipId]/speakers`) finds up to N faces in the segment window (Gemini → GPT-4o → centered fallback). **Export** (`editRender.ts` `framePieceFilters`): multi → `split` the trimmed source N ways, `crop`+`scale` each pane to its slot, `overlay` all onto the black canvas — mirrors the preview. `kind` absent / `"single"` = unchanged single-frame behavior (backward compatible). **Timeline** (`timeline.tsx`): framing chip shows `Split`/`Triple`/`Quad`; Fill/Fit **layers are selectable** (chip or the video-track segment box) — a selected segment shows left/right **trim handles** on the video track (drag = re-time the cut / trim clip in-out), **Split** adds a layer and **Delete** removes it (merges its span into a neighbor).
- **3C.2 — "Video-as-object" reframe model** (replaces the old crop-over-source model): the preview IS the output canvas; the base video is a movable, aspect-locked-scalable layer placed inside it per the active segment's **`frame {x,y,w,h}`** (canvas-normalized; overflow = Fill, inside-with-bars = Fit). New schema on `LayoutSegment`: `frame?` + `cropAspect?` (kept alongside `crop`/`mode`). Shared geometry in `lib/clip/layout-geom.ts` (`resolveFrame` derives a `frame` from `mode` when absent — backward compatible; `coverFrame`/`containFrame`/`centeredCrop`/`aspectRatioValue`/`cropRegionAspect`). `preview-canvas.tsx` renders the canvas → video box (crop CSS) with **always-on** dashed border + 4 corner handles (drag to move, corners scale uniformly) + a floating **Fill/Fit/Crop** toolbar acting on the segment at the playhead (no "Adjust frame" toggle; **aspect ratio is chosen inside the Crop modal**, not the toolbar). `timeline.tsx` Fill/Fit chips now **select** (seek) instead of toggling; the **video track** shows a **draggable cut divider** at each split (C/Split) to re-time the cut. **Split shortcut rebound `S`→`C`** (`shortcuts.ts`); split copies `frame`/`crop`. `crop-modal.tsx` gained an **aspect-ratio dropdown** (custom/original/9:16/1:1/16:9/4:3/9:8/4:5) and returns `cropAspect`; a non-output ratio implies a letterboxed Fit. Export (`editRender.ts`) reframes **per piece** via `framePieceFilters`: crop region → `scale` to the box → `overlay` on a black `w×h` canvas (handles Fill overflow + Fit bars uniformly), splitting the edited timeline at every kept-segment edge AND layout boundary.

### Clip Editor (Phase 3E: crop fix, magnetic snapping, layer presets, blurred background)

Four additions on top of Phase 3, all preview+export parity where applicable:

- **Crop modal fix** (`crop-modal.tsx`): the outer dim over the un-cropped area was lightened (0.45→0.2 — no more "blackout") and the source `<video>` now `preload="auto"` + re-seeks on `loadeddata` so a real decoded frame always paints.
- **Magnetic snapping** (`preview-canvas.tsx` `startMove`): dragging the single-layout video box snaps its edges/center to the canvas (Figma-style, 14px threshold) with cyan alignment guides, and locks to the overflow axis — a horizontal (Fill) video pans X only, a vertical one pans Y only; Fit (inside) allows both.
- **Layer presets** (`lib/clip/layer-presets.ts` + `LayerPresetsPanel` in `rail-panels.tsx`, rail id `presets`): reusable branding overlays (bottom banner / logo / social handle / subtitle safe-area / watermark) saved in **localStorage** (persist across projects). Save/rename/delete/apply presets; per-layer enable toggles; **Apply** materializes enabled layers (z-ordered) into `edit.textOverlays` as normal editable overlays. `TextOverlayStyle.opacity?` added (preview + ASS export honor it; `buildOverlayAss` now emits per-overlay `\c` color + `\alpha`). Note: text-overlay **backgrounds** (banner strip) still don't export — text/color/opacity/position do.
- **Auto blurred background** (`BlurBackground` on `ClipEdit` + `BackgroundPanel`, rail id `background`): for single-layout **Fit** segments that leave bars, fills the canvas with a cover-scaled, blurred copy of the SAME frame. Preview draws it on a `<canvas>` behind the video reusing the ONE decoded element (synced); export mirrors it in `framePieceFilters` (split → `gblur`+`eq` cover background instead of solid black). Controls: blur / scale / brightness / opacity.

---

## Workspace Structure

```
.
├── CLAUDE.md                              # This file
├── .env                                   # API keys (not committed)
├── app/                                   # Next.js application
│   ├── src/
│   │   ├── app/                           # Pages and API routes
│   │   │   ├── page.tsx                   # Dashboard
│   │   │   ├── videos/page.tsx            # Videos browser with thumbnails
│   │   │   ├── run/page.tsx               # Pipeline runner with live progress
│   │   │   ├── configs/page.tsx           # Config management
│   │   │   ├── creators/page.tsx          # Creator management
│   │   │   ├── outreach/                  # Lead Intelligence vertical
│   │   │   │   ├── prospects/page.tsx    # "Leads" workspace (thin composition)
│   │   │   │   ├── dashboard/page.tsx    # CRM dashboard (stats + charts)
│   │   │   │   └── templates/page.tsx    # Offer templates
│   │   │   └── api/                       # API routes (configs, creators, videos, pipeline, outreach/*)
│   │   ├── components/outreach/           # Lead Intelligence UI (shadcn primitives only)
│   │   ├── hooks/                         # use-leads.ts, use-lead-filters.ts
│   │   ├── lib/                           # Core logic
│   │   │   ├── pipeline.ts               # Pipeline orchestration
│   │   │   ├── apify.ts                  # Apify scraper client
│   │   │   ├── gemini.ts                 # Gemini video analysis client
│   │   │   ├── claude.ts                 # Claude concept generation client
│   │   │   ├── csv.ts                    # CSV read/write utilities
│   │   │   ├── outreach.ts               # Prospect lists / templates store (+ defaultLeadFields)
│   │   │   ├── lead-scoring.ts           # levelFromScore + LEVEL_META/STATUS_META/labels
│   │   │   ├── llm-client.ts             # Shared OpenAI/OpenRouter client (draft + analyze)
│   │   │   ├── clip/                     # Clipping pipeline (long video → clips)
│   │   │   │   ├── ffmpeg.ts            # Bundled ffmpeg/ffprobe + yt-dlp runner
│   │   │   │   ├── download.ts          # yt-dlp inspect/download + upload save
│   │   │   │   ├── transcribe.ts        # Deepgram/AssemblyAI word-level transcript
│   │   │   │   ├── moments.ts           # LLM viral-moment selection
│   │   │   │   ├── captions.ts          # .ass caption presets + hook overlay
│   │   │   │   ├── render.ts            # cut + reframe + caption burn (one pass)
│   │   │   │   ├── clipPipeline.ts      # Orchestrator (download→transcribe→select→render)
│   │   │   │   ├── llm.ts               # Shared chat client + JSON extraction
│   │   │   │   ├── store.ts             # jobs.json / clips.csv / accounts / edits / transcripts
│   │   │   │   ├── edit-timeline.ts     # Pure time-mapping (removed ranges ↔ source/edited)
│   │   │   │   ├── editRender.ts        # ClipEdit → ffmpeg export (cuts/reframe/captions/audio)
│   │   │   │   └── social/instagram.ts  # Meta OAuth + Graph publish (gated)
│   │   │   └── types.ts                  # TypeScript interfaces
│   │   └── components/                    # UI components (shadcn + custom)
│   └── package.json
├── data/                                  # CSV data storage
│   ├── configs.csv                        # Pipeline configurations
│   ├── creators.csv                       # Instagram creator accounts
│   └── videos.csv                         # Analyzed video results
├── context/                               # Background context for Claude
├── plans/                                 # Implementation plans
└── .claude/commands/                      # Slash commands (prime, create-plan, implement)
```

---

## App Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Summary stats, recent videos |
| Videos | `/videos` | Browse results with thumbnails, expandable analysis & concepts |
| Run Pipeline | `/run` | Select config, set params, run with live progress streaming |
| Configs | `/configs` | CRUD for pipeline configs (prompts, categories) |
| Creators | `/creators` | CRUD for competitor Instagram accounts |
| Lead Dashboard | `/outreach/dashboard` | CRM dashboard: 9 metrics + priority/pipeline charts |
| Leads | `/outreach/prospects` | Leads workspace: import, analyze, score, filter, message, CRM |
| Templates | `/outreach/templates` | Offer templates feeding personalization prompts |
| New Clip | `/clip` | Paste a URL / upload → configure → live processing → ranked clips |
| Clip Projects | `/clip/projects` | List of all clipping jobs |
| Clip Results | `/clip/[jobId]` | Scored clip grid: preview, download, edit, schedule |
| Clip Editor | `/clip/[jobId]/[clipId]/edit` | Timeline editor: transcript/speech-cleanup, captions, framing, overlays, audio, **Export** |
| Social Accounts | `/clip/social` | Connect Instagram (Meta OAuth); publish gated by flag |

---

## Commands

### /prime
Initialize a new session with full context awareness.

### /create-plan [request]
Create a detailed implementation plan in `plans/`.

### /implement [plan-path]
Execute a plan step by step.

---

## Critical Instruction: Maintain This File

After any change to the workspace, ask:
1. Does this change add new functionality?
2. Does it modify the workspace structure documented above?
3. Should a new command be listed?
4. Does context/ need updates?

If yes, update the relevant sections.

---

## Session Workflow

1. **Start**: Run `/prime` to load context
2. **Work**: Use commands or direct Claude with tasks
3. **Plan changes**: Use `/create-plan` before significant additions
4. **Execute**: Use `/implement` to execute plans
5. **Maintain**: Claude updates CLAUDE.md and context/ as the workspace evolves
