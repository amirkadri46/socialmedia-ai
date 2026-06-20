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
- **Export** (`lib/clip/editRender.ts`, `POST /api/clip/[jobId]/[clipId]/export` SSE): pass 1 = speech cuts + Fill/Fit reframe + audio concat; pass 2 = burn captions (`buildAssFromConfig`) + text overlays + mix uploaded audio → `data/clips/{clipId}-edited.mp4`, then `updateClip` points the clip at it. Media/B-roll/transition compositing exists in preview + model; export support for those is a later increment.
- **Caption parity:** `lib/clip/captions.ts` (server ASS) and `lib/clip/caption-styles.ts` (client preview) are the two parity sources — add any new caption field to both.

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
│   │   │   └── api/                       # API routes (configs, creators, videos, pipeline)
│   │   ├── lib/                           # Core logic
│   │   │   ├── pipeline.ts               # Pipeline orchestration
│   │   │   ├── apify.ts                  # Apify scraper client
│   │   │   ├── gemini.ts                 # Gemini video analysis client
│   │   │   ├── claude.ts                 # Claude concept generation client
│   │   │   ├── csv.ts                    # CSV read/write utilities
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
