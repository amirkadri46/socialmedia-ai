# PROJECT_IMPLEMENTATION_REFERENCE.md

**Social Media AI — Complete Implementation Reference**
Generated: 2026-06-27 | Based on actual source inspection

---

## 1. Project Overview

### Purpose

**Social Media AI** (internal name: *Virality System*) is a multi-vertical SaaS tool for Instagram growth and outreach. It combines three largely independent workstreams in one Next.js application:

1. **Content Intelligence Pipeline** — Scrapes competitor Instagram accounts via Apify, downloads videos, analyzes them with Gemini, and generates adapted content concepts with an OpenAI/OpenRouter-backed LLM. Results power creative decision-making.
2. **Clipping Pipeline** — Downloads long-form video from any URL (yt-dlp) or accepts direct uploads, transcribes speech (Deepgram/AssemblyAI), picks viral moments via LLM, renders captioned vertical clips via FFmpeg, and publishes them to Instagram via Meta Graph API.
3. **Outreach / Lead Intelligence** — Imports CSV leads (Google Maps exports, LinkedIn CSVs), scores them with AI, generates multi-channel outreach messages (WhatsApp, Email, cold-call script), and tracks them through a CRM pipeline.

There is also an emerging **Publishing System** vertical (campaigns, video library, upload jobs) that is code-complete but operationally separate from the clip pipeline.

### Major Workflows

| Workflow | Entry Point | Output |
|---|---|---|
| Content Intelligence | `/run` → `POST /api/pipeline` | Analyzed video entries in `data/videos.csv` |
| Clip generation | `/clip` → `POST /api/clip` | Rendered mp4 clips in `data/clips/` |
| Clip editing | `/clip/[jobId]/[clipId]/edit` | Edited mp4 at `data/clips/{clipId}-edited.mp4` |
| Social publishing (clipping) | `/clip/social` → schedule modal | `ScheduledPost` records; published by the scheduler |
| Lead import + analysis | `/outreach/prospects` → `POST /api/outreach/analyze` | Scored/messaged leads in `data/outreach-lists.json` |
| Bulk download | `/downloader` → `POST /api/downloader/queue` | Downloaded mp4s in configurable directory |
| Publishing campaigns | `/campaigns` → `POST /api/campaigns/[id]/publish` | `UploadJob` records queued for the worker |

### Overall Architecture

The application is a **monolithic Next.js 16 app** (App Router) that serves both the UI and every API route. The publishing system's background jobs run **in-process** inside the same Node server, started on boot from `app/src/instrumentation.ts` (worker code at `app/src/lib/worker/`). Everything shares the same Supabase database.

Two storage abstractions exist in parallel:

- **File-based storage** (`data/` directory, CSV + JSON) — used by the clipping pipeline, outreach, content intelligence, and downloader.
- **Supabase + R2 storage** — used by the publishing system (video library, campaigns, upload jobs).

The `STORAGE_BACKEND` env var switches the `repos` abstraction layer between file and Supabase for the clipping/outreach entities. When set to `supabase`, every `repos.*` call routes to a Supabase implementation instead of file I/O.

### Runtime Architecture

```
                  ┌────────────────────────────────┐
                  │     Next.js App (port 3000)     │
                  │  App Router + React 19 client   │
                  │                                  │
                  │  /api/*  ← all API routes        │
                  │  SSE streams for long ops        │
                  └──────────┬────────────┬──────────┘
                             │            │
                     ┌───────▼──┐   ┌────▼──────────┐
                     │ Supabase  │   │  Cloudflare R2 │
                     │ Postgres  │   │  Object Store  │
                     └───────────┘   └────────────────┘
                             │
                     ┌───────▼──────────────┐
                     │  Worker (tsx process) │
                     │  campaign-runner.ts   │
                     │  publisher.ts         │
                     │  token-refresh.ts     │
                     └──────────────────────┘
```

The worker (publisher, campaign runner, token refresh) runs in-process with the web server in both development (`next dev`) and production (Railway `next start`), launched once from `app/src/instrumentation.ts`. No separate worker process or Railway service is required.

### Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.1.6 (App Router), React 19, TypeScript 5 |
| Styling | Tailwind CSS v4, shadcn/ui component library |
| Auth | Clerk (`@clerk/nextjs` v7) |
| Database | Supabase (Postgres), accessed via `@supabase/supabase-js` |
| Object Storage | Cloudflare R2 (S3-compatible, via `@aws-sdk/client-s3`) |
| Video download | `yt-dlp` (external binary) |
| Video processing | FFmpeg via `ffmpeg-static` + `ffprobe-static` |
| Transcription | Deepgram nova-2 (default), AssemblyAI (fallback) |
| AI — analysis | Google Gemini Flash (video understanding, auto-reframe) |
| AI — generation | OpenAI GPT-4o or OpenRouter (configurable model) |
| Scraping | Apify Instagram scraper actor |
| Data (legacy) | CSV files + JSON files in `data/` directory |
| Deployment | Railway (Docker, `Dockerfile` in root) |
| Runtime (worker) | Node.js via `tsx` |

---

## 2. Folder Structure

```
social-media-main/
├── .env                          # All secrets and config (not committed in prod)
├── CLAUDE.md                     # Developer context and session instructions
├── Dockerfile                    # Production container for Railway
├── railway.toml                  # Railway deploy config (dockerfile builder)
│
├── app/                          # Next.js application root
│   ├── next.config.ts            # Next.js config (loads .env from root, serverExternalPackages)
│   ├── package.json              # All npm dependencies
│   ├── src/
│   │   ├── app/                  # Next.js App Router pages + API routes
│   │   │   ├── layout.tsx        # Root layout: Clerk, ThemeProvider, Sidebar, Toaster
│   │   │   ├── page.tsx          # Dashboard
│   │   │   ├── api/              # All API route handlers (see Section 3)
│   │   │   ├── campaigns/        # Campaign management pages
│   │   │   ├── clip/             # Clipping pipeline pages
│   │   │   ├── configs/          # Config CRUD page
│   │   │   ├── creators/         # Creator CRUD page
│   │   │   ├── downloader/       # Bulk downloader pages
│   │   │   ├── library/          # Video library page (publishing system)
│   │   │   ├── outreach/         # Lead intelligence pages
│   │   │   ├── run/              # Content pipeline runner page
│   │   │   ├── settings/         # App settings page
│   │   │   ├── videos/           # Analyzed video browser
│   │   │   ├── sign-in/          # Clerk sign-in page
│   │   │   └── sign-up/          # Clerk sign-up page
│   │   │
│   │   ├── components/           # Shared and feature-specific UI components
│   │   │   ├── app-sidebar.tsx   # Main navigation sidebar
│   │   │   ├── top-bar.tsx       # Header with user controls
│   │   │   ├── theme-provider.tsx
│   │   │   ├── markdown-content.tsx
│   │   │   ├── campaigns/        # Campaign-specific components
│   │   │   ├── clip/             # Clipping UI + editor components
│   │   │   ├── downloader/       # Downloader UI components
│   │   │   ├── library/          # Video library UI components
│   │   │   ├── outreach/         # Lead intelligence UI components
│   │   │   └── ui/               # shadcn/ui primitives
│   │   │
│   │   ├── context/
│   │   │   └── pipeline-context.tsx  # React context for content pipeline SSE
│   │   │
│   │   ├── hooks/
│   │   │   ├── use-leads.ts           # Leads list state + mutations
│   │   │   ├── use-lead-filters.ts    # Persisted filter state (localStorage)
│   │   │   └── use-mobile.ts          # Breakpoint detection
│   │   │
│   │   ├── lib/                  # Server-side business logic and utilities
│   │   │   ├── types.ts          # All TypeScript interfaces (single source)
│   │   │   ├── pipeline.ts       # Content intelligence orchestrator
│   │   │   ├── apify.ts          # Apify API client
│   │   │   ├── gemini.ts         # Gemini video upload + analysis client
│   │   │   ├── claude.ts         # Claude concept generation client
│   │   │   ├── csv.ts            # Generic CSV read/write for configs/creators/videos
│   │   │   ├── outreach.ts       # File-backed prospect lists + offer templates
│   │   │   ├── lead-scoring.ts   # levelFromScore + metadata constants
│   │   │   ├── llm-client.ts     # Shared OpenAI/OpenRouter factory
│   │   │   ├── settings.ts       # File-backed AppSettings read/write
│   │   │   ├── supabase.ts       # Supabase client factory (server + browser)
│   │   │   ├── utils.ts          # cn() tailwind utility
│   │   │   │
│   │   │   ├── clip/             # Clipping pipeline logic
│   │   │   │   ├── clipPipeline.ts    # Main orchestrator (download→transcribe→select→render)
│   │   │   │   ├── download.ts        # yt-dlp inspect/download + upload save + cookieArgs
│   │   │   │   ├── transcribe.ts      # Deepgram + AssemblyAI transcription
│   │   │   │   ├── moments.ts         # LLM viral-moment selection
│   │   │   │   ├── render.ts          # FFmpeg clip render (reframe + caption burn)
│   │   │   │   ├── captions.ts        # .ass subtitle file generation
│   │   │   │   ├── caption-styles.ts  # Client-side caption preview styles
│   │   │   │   ├── editRender.ts      # ClipEdit → FFmpeg export (Phase 2/3)
│   │   │   │   ├── edit-timeline.ts   # Pure time-mapping math (shared preview/export)
│   │   │   │   ├── ffmpeg.ts          # Binary resolution + process runner + probe
│   │   │   │   ├── filmstrip.ts       # Thumbnail sprite sheet generation
│   │   │   │   ├── waveform.ts        # Audio amplitude envelope
│   │   │   │   ├── autoframe.ts       # Gemini/GPT-4o speaker detection + fill/fit
│   │   │   │   ├── face-crop.ts       # Face-centered crop rect computation
│   │   │   │   ├── layer-presets.ts   # Branding overlay preset definitions
│   │   │   │   ├── layout-geom.ts     # Shared slot geometry (split/triple/quad)
│   │   │   │   ├── llm.ts             # Shared chat() + extractJson() for clipping
│   │   │   │   ├── shortcuts.ts       # Editor keyboard shortcut definitions
│   │   │   │   ├── store.ts           # File-backed jobs/clips/accounts/edits/transcripts
│   │   │   │   └── social/
│   │   │   │       ├── instagram.ts   # Meta OAuth + Graph API publish
│   │   │   │       └── scheduler.ts   # In-process scheduled-post processor
│   │   │   │
│   │   │   ├── db/               # Repository abstraction layer
│   │   │   │   ├── index.ts           # repos singleton (switches file vs Supabase)
│   │   │   │   ├── client.ts          # Supabase client factory
│   │   │   │   ├── types.ts           # Publishing system DB types
│   │   │   │   ├── schema.sql         # Legacy reference schema
│   │   │   │   ├── repos/             # Per-entity repos (file + supabase implementations)
│   │   │   │   │   ├── clip-jobs.ts
│   │   │   │   │   ├── clips.ts
│   │   │   │   │   ├── clip-edits.ts
│   │   │   │   │   ├── clip-transcripts.ts
│   │   │   │   │   ├── social-accounts.ts
│   │   │   │   │   ├── scheduled-posts.ts
│   │   │   │   │   ├── caption-templates.ts
│   │   │   │   │   ├── caption-prompt-templates.ts
│   │   │   │   │   ├── settings.ts
│   │   │   │   │   ├── configs.ts
│   │   │   │   │   ├── creators.ts
│   │   │   │   │   ├── videos.ts
│   │   │   │   │   ├── prospects.ts
│   │   │   │   │   └── offer-templates.ts
│   │   │   │   └── repositories/      # Publishing system repositories (Supabase-only)
│   │   │   │       ├── account-repository.ts
│   │   │   │       ├── campaign-repository.ts
│   │   │   │       ├── publish-history-repository.ts
│   │   │   │       ├── storage-object-repository.ts
│   │   │   │       ├── upload-job-repository.ts
│   │   │   │       ├── video-caption-repository.ts
│   │   │   │       └── video-repository.ts
│   │   │   │
│   │   │   ├── services/          # Higher-level service layer (publishing system)
│   │   │   │   ├── campaign-service.ts
│   │   │   │   ├── schedule-service.ts
│   │   │   │   ├── video-ingestion-service.ts
│   │   │   │   └── video-library-service.ts
│   │   │   │
│   │   │   ├── downloader/        # Bulk downloader logic
│   │   │   │   ├── engine.ts      # Single-job inspect + download
│   │   │   │   ├── queue-runner.ts # Process-singleton queue runner
│   │   │   │   ├── scraper.ts     # Profile URL → video URL list via yt-dlp --flat-playlist
│   │   │   │   ├── store.ts       # File-backed queue + settings
│   │   │   │   └── types.ts       # DownloadJob, DownloaderSettings
│   │   │   │
│   │   │   └── storage/           # Object storage abstraction
│   │   │       ├── index.ts       # getStorageProvider() factory
│   │   │       ├── r2.ts          # Cloudflare R2 provider (S3 SDK)
│   │   │       └── types.ts       # StorageProvider interface
│   │   │
│   │   ├── instrumentation.ts     # Next.js startup hook (starts the scheduler)
│   │   └── middleware.ts          # Clerk auth middleware (all routes except sign-in/up)
│
├── worker/                        # Publishing system background worker
│   ├── index.ts                   # Entry point (intervals for 3 ticks)
│   ├── campaign-runner.ts         # Generates upload_jobs from running campaigns
│   ├── publisher.ts               # Claims + executes upload_jobs → Instagram
│   ├── instagram-publisher.ts     # Container create/wait/publish helpers
│   ├── token-refresh.ts           # Refreshes expiring IG access tokens
│   └── lib/
│       ├── supabase.ts            # Worker's own Supabase client
│       └── storage.ts             # Worker's signed URL helper (R2)
│
├── data/                          # File-based storage (gitignored in prod)
│   ├── configs.csv                # Pipeline configurations
│   ├── creators.csv               # Instagram competitor accounts
│   ├── videos.csv                 # Analyzed video results
│   ├── clips.csv                  # Rendered clips index
│   ├── clip-jobs.json             # Clip pipeline job states
│   ├── clip-edits/                # Per-clip ClipEdit JSON documents
│   ├── clip-transcripts/          # Per-job word-timing arrays
│   ├── clips/                     # Rendered mp4s, thumbnails, source videos
│   ├── social-accounts.json       # Connected IG accounts (with access tokens)
│   ├── scheduled-posts.json       # Pending/published post records
│   ├── outreach-lists.json        # All prospect lists
│   ├── outreach-templates.json    # Offer templates
│   ├── caption-prompt-templates.json  # Creator caption context templates
│   ├── settings.json              # App settings (non-Supabase mode)
│   ├── download-queue.json        # Bulk downloader queue
│   ├── downloader-settings.json   # Downloader configuration
│   └── csv/                       # CSV snapshots of prospect lists
│
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql   # Publishing system tables (pub_*)
│       ├── 002_app_settings.sql     # app_settings single-row table
│       ├── 003_fix_ytdlp_cookies_nullable.sql
│       └── 004_api_keys_in_settings.sql  # API key columns added to app_settings
│
├── plans/                         # Implementation plans (historical)
├── context/                       # Creator/brand context files for Claude prompts
└── scripts/                       # One-off migration / utility scripts
```

---

## 3. Routes

### App Routes (Pages)

| Route | File | Description |
|---|---|---|
| `/` | `app/src/app/page.tsx` | Dashboard with summary stats |
| `/videos` | `app/src/app/videos/page.tsx` | Browse analyzed Reels with thumbnails + analysis |
| `/run` | `app/src/app/run/page.tsx` | Content pipeline runner with live SSE progress |
| `/configs` | `app/src/app/configs/page.tsx` | CRUD for analysis/generation configs |
| `/creators` | `app/src/app/creators/page.tsx` | CRUD for competitor Instagram accounts |
| `/settings` | `app/src/app/settings/page.tsx` | App settings (API keys, transcription, social publish) |
| `/clip` | `app/src/app/clip/page.tsx` | New clip job: URL or file upload, configuration |
| `/clip/projects` | `app/src/app/clip/projects/page.tsx` | All clip jobs list |
| `/clip/[jobId]` | `app/src/app/clip/[jobId]/page.tsx` | Clip results: scored grid with preview/download/edit/schedule |
| `/clip/[jobId]/[clipId]/edit` | `app/src/app/clip/[jobId]/[clipId]/edit/page.tsx` | Timeline editor |
| `/clip/social` | `app/src/app/clip/social/page.tsx` | Connect Instagram accounts; view connected accounts |
| `/downloader` | `app/src/app/downloader/page.tsx` | Bulk YouTube/Instagram downloader |
| `/downloader/settings` | `app/src/app/downloader/settings/page.tsx` | Downloader config (save dir, quality, concurrency) |
| `/library` | `app/src/app/library/page.tsx` | Video library (publishing system; R2-backed) |
| `/campaigns` | `app/src/app/campaigns/page.tsx` | Campaign list |
| `/campaigns/new` | `app/src/app/campaigns/new/page.tsx` | Create campaign |
| `/campaigns/[id]` | `app/src/app/campaigns/[id]/page.tsx` | Campaign detail |
| `/campaigns/history` | `app/src/app/campaigns/history/page.tsx` | Publish history |
| `/campaigns/queue` | `app/src/app/campaigns/queue/page.tsx` | Upload job queue |
| `/outreach/dashboard` | `app/src/app/outreach/dashboard/page.tsx` | CRM dashboard (9 stat cards + charts) |
| `/outreach/prospects` | `app/src/app/outreach/prospects/page.tsx` | Leads workspace |
| `/outreach/templates` | `app/src/app/outreach/templates/page.tsx` | Offer templates |
| `/sign-in/[[...sign-in]]` | Clerk-managed | Clerk sign-in UI |
| `/sign-up/[[...sign-up]]` | Clerk-managed | Clerk sign-up UI |

### API Routes

#### Content Intelligence Pipeline

| Route | Method | Description | Input | Output |
|---|---|---|---|---|
| `POST /api/pipeline` | POST | Run content intelligence pipeline | `PipelineParams` JSON | SSE stream of `PipelineProgress` |
| `GET /api/configs` | GET | List all configs | — | `Config[]` |
| `POST /api/configs` | POST | Create/update config | `Config` JSON | `Config` |
| `GET /api/creators` | GET | List all creators | — | `Creator[]` |
| `POST /api/creators` | POST | Create/update creator | `Creator` JSON | `Creator` |
| `POST /api/creators/refresh` | POST | Re-scrape creator stats | `{ username }` | `Creator` |
| `GET /api/videos` | GET | List analyzed videos | query: `starred`, `configName`, `search` | `Video[]` |
| `GET /api/analyze-url` | GET | Fetch video metadata via yt-dlp | query: `url` | `SourceMeta` |

#### Clipping Pipeline

| Route | Method | Description | Input | Output |
|---|---|---|---|---|
| `GET /api/clip` | GET | List all clip jobs | — | `ClipJob[]` |
| `POST /api/clip` | POST | Start new clip job | `multipart/form-data` (file + job JSON) or JSON `ClipJob` partial | SSE stream of `ClipProgress` |
| `GET /api/clip/[jobId]` | GET | Get job + clips + live progress | — | `{ job, clips, progress }` |
| `POST /api/clip/[jobId]/cancel` | POST | Cancel running job | — | `{ ok }` |
| `GET /api/clip/[jobId]/source` | GET | Stream the source video file | — | mp4 stream |
| `GET /api/clip/[jobId]/filmstrip` | GET | Job thumbnail sprite sheet | `?meta=1` for geometry | JPEG or JSON geometry |
| `GET /api/clip/[jobId]/waveform` | GET | Audio amplitude envelope | — | JSON number array |
| `GET /api/clip/[jobId]/[clipId]/edit` | GET | Get ClipEdit document | — | `ClipEdit` JSON |
| `PUT /api/clip/[jobId]/[clipId]/edit` | PUT | Save ClipEdit document | `ClipEdit` JSON | `{ ok }` |
| `POST /api/clip/[jobId]/[clipId]/export` | POST | Render ClipEdit → final mp4 | — | SSE progress stream |
| `POST /api/clip/[jobId]/[clipId]/autoframe` | POST | Auto fill/fit speaker detection | — | `LayoutSegment[]` |
| `POST /api/clip/[jobId]/[clipId]/speakers` | POST | Detect speaker panes for layout | — | `SpeakerPane[][]` |
| `POST /api/clip/[jobId]/[clipId]/face-crop` | POST | Build face-centered crop rect | `{ segmentId, paneIndex }` | `CropRect` |
| `GET /api/clip/[jobId]/[clipId]/speakers` | GET | (same route, GET variant) | — | speaker data |
| `GET /api/clip/media/[clipId]` | GET | Stream clip mp4 (for publishing) | — | mp4 stream |
| `GET /api/clip/thumb/[clipId]` | GET | Serve clip thumbnail image | — | JPEG |
| `GET /api/clip/download/[clipId]` | GET | Download clip mp4 as attachment | — | mp4 file |
| `GET /api/clip/asset/[clipId]` | GET | List assets for a clip | — | file list |
| `GET /api/clip/asset/[clipId]/[name]` | GET | Serve a specific asset file | — | file |
| `POST /api/clip/inspect` | POST | Inspect URL metadata via yt-dlp | `{ url }` | `SourceMeta` |

#### Social / Instagram

| Route | Method | Description | Input | Output |
|---|---|---|---|---|
| `GET /api/clip/social/accounts` | GET | List connected social accounts | — | `Omit<SocialAccount, 'accessToken'>[]` |
| `POST /api/clip/social/connect` | POST | Begin Instagram OAuth flow | `{ accountId? }` | redirect URL or `{ authUrl }` |
| `GET /api/clip/social/callback` | GET | OAuth callback (code exchange) | `code`, `state` query params | redirect to `/clip/social` |
| `POST /api/clip/social/schedule` | POST | Schedule or publish a clip | `ScheduledPost` body | `{ post }` |
| `POST /api/clip/social/process` | POST | Manually trigger scheduled-post processor | — | `{ processed, published }` |
| `POST /api/clip/social/caption` | POST | Generate AI caption for a clip | `CaptionRequest` JSON | `{ caption }` |
| `GET /api/clip/social/caption-templates` | GET | List caption prompt templates | — | `CaptionPromptTemplate[]` |
| `POST /api/clip/social/caption-templates` | POST | Create caption prompt template | `CaptionPromptTemplate` | created template |
| `PATCH /api/clip/social/caption-templates` | PATCH | Update caption prompt template | `{ id, ...fields }` | updated template |
| `DELETE /api/clip/social/caption-templates` | DELETE | Delete caption prompt template | `?id=` | `{ ok }` |

#### Outreach / Lead Intelligence

| Route | Method | Description | Input | Output |
|---|---|---|---|---|
| `GET /api/outreach/lists` | GET | List all prospect lists | — | `ProspectList[]` |
| `POST /api/outreach/lists` | POST | Create new list | `{ name, source? }` | `ProspectList` |
| `GET /api/outreach/lists/[id]` | GET | Get single list | — | `ProspectList` |
| `PATCH /api/outreach/lists/[id]` | PATCH | Update prospect fields | `{ prospectId, ...fields }` | `{ ok }` |
| `DELETE /api/outreach/lists/[id]` | DELETE | Delete list or single prospect | `?prospectId=` | `{ ok }` |
| `POST /api/outreach/import` | POST | Import CSV into a list | `multipart/form-data` with CSV | `{ listId, count }` |
| `POST /api/outreach/draft` | POST | Generate outreach draft for one lead | `{ listId, prospectId, tone? }` | `{ message }` |
| `POST /api/outreach/analyze` | POST | Bulk AI analyze + generate messages | `AnalyzeBody` | SSE stream of phase events |
| `GET /api/outreach/stats` | GET | Aggregate stats across all lists | — | stats object |
| `GET /api/outreach/templates` | GET | List offer templates | — | `OfferTemplate[]` |
| `POST /api/outreach/templates` | POST | Create/update offer template | `OfferTemplate` | saved template |

#### Bulk Downloader

| Route | Method | Description | Input | Output |
|---|---|---|---|---|
| `GET /api/downloader/queue` | GET | Get all download jobs | — | `DownloadJob[]` |
| `POST /api/downloader/queue` | POST | Add URLs to download queue | `{ urls, quality }` | `{ added }` |
| `DELETE /api/downloader/queue` | DELETE | Cancel or clear finished jobs | `{ jobId? }` | `{ ok }` |
| `POST /api/downloader/scrape` | POST | Scrape profile → add URLs | `{ profileUrl }` | `{ added }` |
| `GET /api/downloader/settings` | GET | Get downloader settings | — | `DownloaderSettings` |
| `POST /api/downloader/settings` | POST | Save downloader settings | `DownloaderSettings` | `{ ok }` |

#### Publishing System (Campaigns, Library)

| Route | Method | Description | Input | Output |
|---|---|---|---|---|
| `GET /api/library` | GET | List video library (from download queue) | `?platform, search, limit, offset` | video list |
| `GET /api/library/[id]` | GET | Get video detail + signed URLs | — | `VideoDetail` |
| `DELETE /api/library/[id]` | DELETE | Delete video from library | — | `{ ok }` |
| `POST /api/library/[id]/caption` | POST | Save or generate caption for a video | `{ caption? }` | `{ ok }` |
| `GET /api/campaigns` | GET | List all campaigns | — | `Campaign[]` |
| `POST /api/campaigns` | POST | Create campaign | `{ name, scheduleRule, timezone }` | `Campaign` |
| `GET /api/campaigns/[id]` | GET | Get campaign | — | `Campaign` |
| `PATCH /api/campaigns/[id]` | PATCH | Update campaign | partial `Campaign` | `Campaign` |
| `DELETE /api/campaigns/[id]` | DELETE | Cancel + delete campaign | — | `{ ok }` |
| `GET /api/campaigns/[id]/videos` | GET | List campaign videos | — | `CampaignVideo[]` |
| `POST /api/campaigns/[id]/videos` | POST | Add video to campaign | `{ videoId }` | `{ ok }` |
| `GET /api/campaigns/[id]/accounts` | GET | List campaign accounts | — | `string[]` |
| `POST /api/campaigns/[id]/accounts` | POST | Add account to campaign | `{ accountId }` | `{ ok }` |
| `GET /api/campaigns/[id]/preview` | GET | Calculate schedule preview | — | `CampaignPreview` |
| `POST /api/campaigns/[id]/publish` | POST | Start campaign (status → running) | — | `{ ok }` |
| `POST /api/campaigns/[id]/pause` | POST | Pause campaign | — | `{ ok }` |
| `POST /api/campaigns/[id]/resume` | POST | Resume campaign | — | `{ ok }` |
| `GET /api/accounts` | GET | List Instagram accounts (publishing) | — | `InstagramAccount[]` |
| `GET /api/upload-jobs` | GET | List upload jobs | `?status, campaign_id, limit` | `UploadJob[]` |
| `GET /api/publish-history` | GET | List publish history | `?account_id, limit` | `PublishHistory[]` |

#### Utility

| Route | Method | Description |
|---|---|---|
| `GET /api/settings` | GET | Get app settings (secrets redacted) |
| `POST /api/settings` | POST | Save app settings |
| `GET /api/proxy-image` | GET | Proxy CDN images (CORS workaround for Instagram thumbnails) |

---

## 4. Components

### Layout Components

**`app/src/components/app-sidebar.tsx`**
- Navigation sidebar with links to all main sections
- Collapsed to icon-only (58px width); tooltip labels on hover
- Sections: Dashboard, Videos, Run, Configs, Creators | Clip, Social Accounts | Downloads | Library, Campaigns | Outreach (Dashboard, Leads, Templates) | Settings
- No props; reads route to highlight active item

**`app/src/components/top-bar.tsx`**
- Header rendered above every page
- Contains Clerk user button + theme toggle
- No props

**`app/src/components/theme-provider.tsx`**
- Wraps `next-themes` ThemeProvider; supports light/dark/system

### Clip Editor Components (`app/src/components/clip/editor/`)

**`editor-shell.tsx`**
- Top-level editor layout: transport controls, timeline rail, export button
- Consumes `useClipEdit` hook for all state
- Children: `PreviewCanvas`, `Timeline`, `RailPanels`, `CaptionsPanel`, `TranscriptPanel`

**`preview-canvas.tsx`**
- Renders the live composite preview of the edited clip
- Single `<video>` decoded once; composited onto `<canvas>` for multi-pane layouts
- Handles drag-to-reposition (single layout), magnetic snapping with alignment guides
- Renders text overlays, media overlays, caption overlay, blurred background
- Props: `edit: ClipEdit`, `clip: Clip`, `job: ClipJob`, `words: Word[]`

**`timeline.tsx`**
- Opus-style timeline: filmstrip track, waveform, per-segment chips, drag/trim
- Ctrl+wheel zoom; drag-select → cut; split at playhead; trim handles on video track
- Transition markers rendered as visual pins
- Props: `edit: ClipEdit`, `onEdit: (e: ClipEdit) => void`, `jobId: string`, `clipId: string`

**`captions-panel.tsx`**
- Caption preset picker, font controls, effects (position/animation/lines)
- Props: `caption: CaptionConfig`, `onChange: (c: CaptionConfig) => void`

**`caption-render.tsx`**
- Browser twin of the server-side ASS caption renderer
- Draws karaoke-style word-by-word highlights on a canvas overlay
- Props: `words: Word[]`, `caption: CaptionConfig`, `currentTime: number`, etc.

**`transcript-panel.tsx`**
- Live word highlight + auto-scroll during playback; click-to-seek
- Drag-select for highlight/edit/delete popup (word-level overrides → `ClipEdit.wordStyles`)
- Props: `words: Word[]`, `edit: ClipEdit`, `onEdit`, `currentTime: number`

**`crop-modal.tsx`**
- Aspect-ratio dropdown (9:16, 1:1, 16:9, 4:3, etc.) + draggable crop frame
- Returns `CropRect` and `cropAspect` to the parent
- Preloads the source video with `preload="auto"` and seeks on `loadeddata`

**`rail-panels.tsx`**
- Tabbed rail below the timeline: Media, B-Roll, Transitions, Audio, Presets, Background
- `LayerPresetsPanel`: create/rename/delete/apply branding presets (localStorage)
- `BackgroundPanel`: blur/scale/brightness/opacity controls for blurred background
- `TransitionsPanel`: transition type + duration slider; adds markers at playhead

**`text-overlay-settings.tsx`**
- Per-overlay popup for font, size, color, alignment, background, opacity

**`use-clip-edit.ts`**
- Custom hook owning all editor state
- Debounced autosave (PUT `/api/clip/[jobId]/[clipId]/edit`) on every change
- Undo/redo stack

**`use-callback-ref.ts`**
- Stable callback ref utility (avoids re-subscribing event listeners on render)

### Clip Components (`app/src/components/clip/`)

**`schedule-modal.tsx`**
- Scheduling dialog shown from clip results; selects account + date/time
- Caption template selector + tone/format/hashtag controls
- Calls `POST /api/clip/social/caption` on template change; calls `POST /api/clip/social/schedule`

**`caption-templates-manager.tsx`**
- CRUD UI for `CaptionPromptTemplate` (creator bio/niche/CTA/hashtags)
- Calls `GET/POST/PATCH/DELETE /api/clip/social/caption-templates`

**`caption-preview.tsx`**
- Shows a static preview of caption style in the schedule modal

### Downloader Components (`app/src/components/downloader/`)

**`url-input-panel.tsx`** — Paste URLs or profile URL; adds to queue
**`profile-input-panel.tsx`** — Profile URL input → scrape → add all videos
**`queue-table.tsx`** — Table of download jobs with real-time progress; polls every 2s
**`status-bar.tsx`** — Summary: waiting/downloading/done counts

### Library Components (`app/src/components/library/`)

**`video-grid.tsx`** — Responsive grid of `VideoCard` components
**`video-card.tsx`** — Thumbnail + title + platform + publish status; click opens preview
**`video-preview-modal.tsx`** — Modal with video player + caption display
**`filter-bar.tsx`** — Platform filter + search input for the video library

### Campaign Components (`app/src/components/campaigns/`)

**`account-selector.tsx`** — Multi-select for Instagram accounts to attach to a campaign
**`campaign-preview-card.tsx`** — Shows estimated duration/first+last post time
**`schedule-rule-editor.tsx`** — Frequency hours, window start/end, timezone, jitter
**`video-selector.tsx`** — Searchable video list to add to a campaign

### Outreach Components (`app/src/components/outreach/`)

**`lead-table.tsx`** — Infinite scroll (IntersectionObserver) table with row-selection checkboxes; bulk-action bar
**`lead-row.tsx`** — Single lead row; inline editable priceQuoted/priceConfirmed/note columns
**`lead-detail-sheet.tsx`** — Side sheet with full lead details + AI messages
**`filter-bar.tsx`** — Status, priority, search, source filters; persisted to localStorage
**`import-wizard.tsx`** — CSV upload + column mapping + source detection (Maps vs LinkedIn)
**`analyze-progress-dialog.tsx`** — SSE-consuming dialog for bulk analyze job; closing does not cancel
**`outreach-message-tabs.tsx`** — Tab switcher: Email / WhatsApp / Cold Call
**`cold-call-card.tsx`** — Structured cold-call brief display
**`priority-badge.tsx`** — Colored badge for hot/high/medium/low
**`lead-status-select.tsx`** — CRM pipeline stage dropdown
**`stat-card.tsx`** — Single metric card for dashboard
**`dashboard-charts.tsx`** — CSS/SVG priority distribution + pipeline funnel (no chart library)

### Context

**`app/src/context/pipeline-context.tsx`**
- React context that owns the content intelligence pipeline state
- Manages SSE connection to `POST /api/pipeline`
- Consumed by the Run page and Dashboard for live progress display

---

## 5. Services

### Content Intelligence Pipeline (`app/src/lib/pipeline.ts`)

**Responsibility:** Orchestrates the content analysis flow: scrape → filter → analyze → generate → save.

**Steps:**
1. Load `Config` from repo
2. Filter `Creator` list by config's `creatorsCategory`
3. Scrape each creator via Apify (2 concurrent)
4. Filter by date, sort by views, take top-K
5. For each video: download → upload to Gemini → analyze → generate new concepts with OpenAI/OpenRouter
6. Batch-append results to video store

**Key interfaces:** `PipelineParams`, `PipelineProgress`, `ActiveTask`
**Dependencies:** `apify.ts`, `gemini.ts`, `claude.ts`, `repos.configs`, `repos.creators`, `repos.videos`

---

### Clipping Pipeline (`app/src/lib/clip/clipPipeline.ts`)

**Responsibility:** Full pipeline: download/upload → transcribe → moment selection → render each clip.

**Steps:**
1. Download via yt-dlp (URL) or save uploaded buffer
2. Copy source to persistent `data/clips/source-{jobId}.mp4`
3. Transcribe audio (Deepgram/AssemblyAI) → persist word timings
4. Select moments via LLM (`moments.ts`)
5. Render each moment (configurable concurrency, default 1) via FFmpeg
6. Sort clips by score; persist via `repos.clips.append`

**Cancellation:** Polled between steps via `repos.clipJobs.isCancelRequested()`.
**Progress:** Emitted via SSE callback + persisted to in-memory store for reconnecting clients.
**Concurrency:** `RENDER_CONCURRENCY` env var (default 1) limits simultaneous FFmpeg encodes.

---

### Clip Editor Export (`app/src/lib/clip/editRender.ts`)

**Responsibility:** Render a `ClipEdit` document into a finished mp4.

**Two FFmpeg passes:**
1. Speech-cut segments + reframe (fill/fit, multi-pane layout) + transitions (xfade/acrossfade) + audio mixing
2. Burn captions (`.ass` from `buildAssFromConfig`) + text overlays + uploaded audio

Output written to `data/clips/{clipId}-edited.mp4`; clip record updated to point at it.

---

### Downloader Service (`app/src/lib/downloader/`)

**`engine.ts`** — Inspects a URL (yt-dlp `--dump-single-json`) and downloads it to a temp dir. Reuses `cookieArgs` from `download.ts` for cookie handling.

**`queue-runner.ts`** — Process-level singleton (`global.__dlRunner`). 2-second tick loop; respects `concurrentDownloads` setting. Per-job phases: inspecting → downloading → uploading (ingest to R2). Survives Next.js dev hot-reloads via `global.__dlRunner`.

**`scraper.ts`** — Profile URL → flat playlist via `yt-dlp --flat-playlist` → array of video URLs.

**`store.ts`** — Reads/writes `data/download-queue.json` and `data/downloader-settings.json`.

---

### Video Ingestion Service (`app/src/lib/services/video-ingestion-service.ts`)

**Responsibility:** Ingest a downloaded video into the publishing system's video library.

**Steps:**
1. Compute SHA-256 checksum → check for duplicate in `storage_objects`
2. If duplicate: return existing video ID, delete temp files
3. Upload mp4 + thumbnail to R2
4. Insert `storage_objects` rows
5. Insert `videos` row (publish_status: "unpublished")

**Dependencies:** `getStorageProvider()`, `storageObjectRepository`, `videoRepository`

---

### Video Library Service (`app/src/lib/services/video-library-service.ts`)

**Responsibility:** Fetch video list/detail with signed R2 URLs; delete videos.

Generates time-limited signed URLs for thumbnails (1h) and video files (6h) via R2 presigner.

---

### Campaign Service (`app/src/lib/services/campaign-service.ts`)

**Responsibility:** CRUD + lifecycle (publish/pause/resume) for campaigns.

On `publish()`: sets status to "running" and creates the initial `campaign_runner_state` record (cursor=0) so the worker can start generating upload jobs.

---

### Schedule Service (`app/src/lib/services/schedule-service.ts`)

**Responsibility:** Pure time math for campaign scheduling.

- `computeFirstSlot(rule)` — First publish slot based on `startDate` + `windowStart`
- `computeNextSlot(rule, from)` — Add `frequencyHours`; clamp to `windowStart`/`windowEnd`; advance to next day if outside window
- `calculatePreview(videoCount, accountCount, rule)` — Estimates full campaign timeline (first/last post, duration)

Uses `date-fns-tz` for timezone-aware arithmetic.

---

### Instagram Publishing (`app/src/lib/clip/social/instagram.ts`)

**Responsibility:** Meta Graph API integration for the clipping pipeline's direct publishing path.

- `buildAuthUrl()` — Constructs consent URL with `instagram_business_basic` + `instagram_business_content_publish` scopes; always includes `force_reauth=true` for multi-account support
- `exchangeCode()` — Short-lived token → long-lived token exchange (~60 days)
- `fetchIgIdentity()` — Fetches `id`, `username`, `account_type` (+ optional `name`/`profile_picture_url`)
- `publishReel()` — Container create → poll for FINISHED status → media_publish

This is the **clipping pipeline's** publishing path (direct, from schedule modal). Distinct from the worker's `instagram-publisher.ts`.

---

### Scheduled Post Processor (`app/src/lib/clip/social/scheduler.ts`)

**Responsibility:** In-process 60-second timer that publishes overdue `ScheduledPost` records.

Started by `app/src/instrumentation.ts` when the Next.js Node server starts. Checks `enableSocialPublish` flag and requires a public HTTPS `APP_URL` before publishing.

---

### Worker — Campaign Runner (`worker/campaign-runner.ts`)

**Responsibility:** Scans running campaigns every 5 minutes; generates `upload_jobs` rows.

- Acquires a 60-second row lock on `campaign_runner_state` (prevents duplicate job creation on multi-worker deployments)
- Iterates campaign videos from `cursor` position; generates one job per video × account combination
- Applies `randomizeMinutes` jitter per slot
- Advances cursor; releases lock

---

### Worker — Publisher (`worker/publisher.ts`)

**Responsibility:** Claims and executes `upload_jobs` every 15 seconds (5 jobs per tick).

- Reclaims orphaned jobs stuck in intermediate states > 15 minutes (crash recovery)
- Atomic claim via `claimed_by` column (prevents double-publish)
- Idempotency check via `publish_history` table
- Enforces 50-post/day per-account limit (reschedules to next day)
- Steps: generating signed URL → creating IG container → waiting for FINISHED → publishing → inserting publish_history row

---

### Token Refresh (`worker/token-refresh.ts`)

**Responsibility:** Refreshes expiring Instagram long-lived access tokens (every 60 minutes in the worker).

---

### LLM Client (`app/src/lib/llm-client.ts`)

**Responsibility:** Factory for OpenAI/OpenRouter client. Shared by outreach draft and lead analyze routes.

Reads `AppSettings.provider` and the appropriate API key. Returns `{ client: OpenAI, model, provider }`. Throws user-facing errors when configuration is missing.

---

### Lead Scoring (`app/src/lib/lead-scoring.ts`)

**Responsibility:** Deterministic conversion of a numeric `priorityScore` (0–100) to a `PriorityLevel` label.

`levelFromScore()` determines the bucket (hot/high/medium/low). The LLM never picks the level — it only provides the score. Exports `LEVEL_META`, `STATUS_META`, `LEAD_STATUS_LABELS`, `LEAD_STATUS_ORDER`, `PRIORITY_LEVELS`.

---

### Storage Abstraction (`app/src/lib/storage/`)

**`StorageProvider` interface:** `upload()`, `getSignedUrl()`, `delete()`, `exists()`

**`r2.ts`:** Cloudflare R2 implementation via AWS S3 SDK. Configured with `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.

Only one provider is implemented. `STORAGE_PROVIDER` env var defaults to `"r2"`.

---

## 6. Data Layer

### Repository Pattern

All data access goes through `repos` (exported from `app/src/lib/db/index.ts`). The `STORAGE_BACKEND` env var selects the backend:

- `STORAGE_BACKEND=file` (default) → file-based implementations in `lib/db/repos/`
- `STORAGE_BACKEND=supabase` → Supabase implementations in `lib/db/repos/`

Both implement the same TypeScript interface per entity, so routes and services are backend-agnostic.

### File-Based Storage (default)

All files live in `data/` at the project root (one level above `app/`).

| Entity | File | Format |
|---|---|---|
| Clip jobs | `data/clip-jobs.json` | JSON array |
| Clips | `data/clips.csv` | CSV |
| Clip edits | `data/clip-edits/{clipId}.json` | JSON per clip |
| Clip transcripts | `data/clip-transcripts/{jobId}.json` | JSON array of `Word` |
| Clip rendered files | `data/clips/{clipId}.mp4`, `.jpg` | Binary |
| Clip edited files | `data/clips/{clipId}-edited.mp4` | Binary |
| Source videos | `data/clips/source-{jobId}.mp4` | Binary |
| Clip assets | `data/clips/assets/{clipId}/` | Binary files |
| Social accounts | `data/social-accounts.json` | JSON array |
| Scheduled posts | `data/scheduled-posts.json` | JSON array |
| Caption templates | `data/caption-templates.json` | JSON array |
| Caption prompt templates | `data/caption-prompt-templates.json` | JSON array |
| App settings | `data/settings.json` | JSON object |
| Configs | `data/configs.csv` | CSV |
| Creators | `data/creators.csv` | CSV |
| Analyzed videos | `data/videos.csv` | CSV |
| Prospect lists | `data/outreach-lists.json` | JSON array |
| Offer templates | `data/outreach-templates.json` | JSON array |
| CSV snapshots | `data/csv/*.csv` | CSV |
| Download queue | `data/download-queue.json` | JSON array |
| Downloader settings | `data/downloader-settings.json` | JSON object |

**Atomic writes:** All JSON/CSV writes use `writeFileAtomic()` — write to a `.tmp` file then `renameSync()` over the target. On the same filesystem, `rename()` is atomic, preventing half-written files on crash or concurrent access.

### Supabase Storage Backend

When `STORAGE_BACKEND=supabase`, the same `repos.*` calls go to Supabase Postgres via `@supabase/supabase-js`. The server client uses the service role key (bypasses RLS). The Supabase repos mirror the file repos' interfaces exactly.

The `app_settings` table (migration 002) stores non-secret preferences. Secrets (API keys) are injected from environment variables by `overlayEnvSecrets()` in `lib/db/repos/settings.ts`. Migration 004 added optional API key columns to `app_settings` as a DB fallback for when env vars are absent (Railway secrets UI).

### Publishing System (Supabase-Only)

The publishing system always uses Supabase directly (not gated by `STORAGE_BACKEND`). These repositories live in `lib/db/repositories/` and call `supabaseServer` directly:

| Repository | Table(s) |
|---|---|
| `videoRepository` | `pub_videos` |
| `storageObjectRepository` | `pub_storage_objects` |
| `videoCaptionRepository` | `pub_video_captions` |
| `campaignRepository` | `pub_campaigns`, `pub_campaign_videos`, `pub_campaign_accounts`, `pub_campaign_runner_state` |
| `uploadJobRepository` | `pub_upload_jobs` |
| `publishHistoryRepository` | `pub_publish_history` |
| `accountRepository` | `pub_instagram_accounts` |

### Live Progress Store (In-Memory)

The clipping pipeline keeps live progress in a process-scoped `Map<jobId, ClipProgress>`. This lets a client that navigated away and returned re-attach to a still-running job without having to re-read the full job from disk. The in-memory store is cleared 30 seconds after the job reaches a terminal state.

The downloader's `QueueRunner` similarly keeps live job state in memory (`Map<id, DownloadJob>`) and merges with the persisted queue on reads.

### Data Flow Summary

```
User action → API Route → repos.* → {
    file:     data/*.json / *.csv
    supabase: Supabase Postgres
}

Clipping pipeline → FFmpeg output → data/clips/*.mp4
Downloader → yt-dlp output → temp dir → ingestVideo() → R2 → pub_videos
Worker publisher → R2 signed URL → Instagram Graph API → pub_publish_history
```

---

## 7. External Integrations

### Apify

- **Used by:** Content intelligence pipeline (`lib/apify.ts`)
- **Purpose:** Scrape recent Instagram Reels for competitor accounts
- **API key:** `APIFY_API_TOKEN` (env or DB)
- **Actor:** Instagram Reels scraper actor
- **Usage pattern:** `scrapeReels(username, maxVideos, nDays)` → array of reel objects with `videoUrl`, `views`, `likes`, `timestamp`

### Google Gemini

- **Used by:** Content intelligence pipeline (`lib/gemini.ts`), auto-reframe detector (`lib/clip/autoframe.ts`)
- **Purpose 1:** Video analysis — upload video buffer, prompt with analysis instruction, get structured output
- **Purpose 2:** Auto-reframe — tile sampled frames into a contact sheet image, classify speaker-present vs none via Gemini Flash vision
- **API key:** `GEMINI_API_KEY` (env)
- **Models:** `gemini-2.5-flash` (default, configurable)
- **Upload method:** Gemini File API (`uploadVideo` → `analyzeVideo`)

### OpenAI / OpenRouter

- **Used by:** Content pipeline concept generation (`lib/claude.ts`), outreach draft + analyze (`lib/llm-client.ts`), clipping LLM (`lib/clip/llm.ts`), caption generation (`api/clip/social/caption`)
- **Purpose:** Concept generation, moment selection, lead scoring + message generation, caption writing
- **Configuration:** Provider (openai or openrouter) + model selectable in Settings. Default: OpenRouter with `deepseek/deepseek-v4-flash`. OpenAI defaults to `gpt-4o`.
- **API keys:** `OPENAI_API_KEY` / OpenRouter key (env or DB)
- **Note:** `lib/claude.ts` is named for historical reasons; it now calls OpenAI's API, not Anthropic's

### Deepgram

- **Used by:** `lib/clip/transcribe.ts`
- **Purpose:** Primary transcription provider; word-level timestamps with `nova-2` model
- **API key:** `DEEPGRAM_API_KEY` (env or DB)
- **Call pattern:** HTTP POST with audio bytes → JSON response with word array

### AssemblyAI

- **Used by:** `lib/clip/transcribe.ts`
- **Purpose:** Fallback transcription provider
- **API key:** `ASSEMBLYAI_API_KEY` (env or DB)
- **Call pattern:** Upload audio → poll for completion (max 30 minutes)

### Instagram Graph API (Meta)

- **Used by:** `lib/clip/social/instagram.ts` (clipping scheduler), `worker/instagram-publisher.ts` (campaign worker)
- **Purpose:** OAuth authentication + Reel publishing
- **Base URL:** `https://graph.instagram.com/v21.0`
- **OAuth flow:** `api.instagram.com/oauth/authorize` → code → short-lived token → long-lived token (~60 days)
- **Scopes:** `instagram_business_basic`, `instagram_business_content_publish`
- **Publishing:** Container create → poll for `status_code === FINISHED` → media_publish
- **Gate:** Live publishing requires `enableSocialPublish=true` in Settings + Meta App Review

### yt-dlp

- **Used by:** `lib/clip/download.ts`, `lib/clip/ffmpeg.ts`, `lib/downloader/engine.ts`, `lib/downloader/scraper.ts`
- **Purpose:** Download video from any URL (YouTube, Instagram, etc.); inspect metadata; scrape flat playlists
- **Binary location:** `YT_DLP_PATH` env var or `yt-dlp` on PATH. On Railway, installed to `/usr/local/bin/yt-dlp` in the Dockerfile
- **Cookie handling:** Netscape-format `cookies.txt` (from `YTDLP_COOKIES` env or settings textarea) or `--cookies-from-browser` for local dev
- **Quality cap:** 1080p for clip pipeline; configurable (720p or 1080p) for bulk downloader

### FFmpeg

- **Used by:** `lib/clip/ffmpeg.ts`, `lib/clip/render.ts`, `lib/clip/editRender.ts`, `lib/clip/filmstrip.ts`, `lib/clip/waveform.ts`, `lib/clip/transcribe.ts`
- **Bundled via:** `ffmpeg-static` (ffmpeg binary) + `ffprobe-static` (ffprobe binary)
- **`next.config.ts`:** `serverExternalPackages: ["ffmpeg-static", "ffprobe-static"]` — prevents Next.js from bundling these; they resolve from `node_modules` at runtime
- **System FFmpeg:** Also installed in the Dockerfile for yt-dlp muxing (separate from bundled ffmpeg)
- **Usage:** Subtitle burning (libass), cover-crop reframe, timeline cuts, audio mixing, filmstrip/waveform generation
- **Font dependency:** `fonts-liberation` + `fonts-dejavu-core` installed in Docker so libass can resolve "Arial" for caption rendering

### Supabase

- **Used by:** Publishing system repositories, Supabase backend for clipping/outreach repos
- **Purpose:** Postgres database for structured data; Row Level Security on `app_settings`
- **Client:** `@supabase/supabase-js` v2; server client uses service role key, never exposed to browser
- **Two clients exist:** `lib/supabase.ts` (publishing system, `supabaseServer`) and `lib/db/client.ts` (repo layer, `serverClient()`). Both use the same credentials; the duplication is historical.

### Cloudflare R2

- **Used by:** `lib/storage/r2.ts`, `worker/lib/storage.ts`
- **Purpose:** Object store for downloaded videos and thumbnails (publishing system)
- **SDK:** AWS S3 SDK (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- **Key pattern:** `videos/{videoId}.mp4`, `thumbnails/{videoId}.jpg`
- **Access:** Pre-signed URLs (6h for video, 1h for thumbnails); never direct public URLs

### Clerk

- **Used by:** `app/src/middleware.ts`, `app/src/app/layout.tsx`, sign-in/sign-up pages
- **Purpose:** Authentication for all routes; all pages except `/sign-in` and `/sign-up` are protected
- **Configuration:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- **UI:** `@clerk/ui` with `shadcn` theme applied

### Railway

- **Purpose:** Production hosting platform; builds via Dockerfile
- **Worker:** The publishing system worker is run as a separate process (npm script `worker`)
- **Env vars:** Injected as Railway service variables; declared as `ARG`/`ENV` in Dockerfile for build-time access (Supabase NEXT_PUBLIC_* must be available at `next build`)

---

## 8. Background Processes

### Content Pipeline SSE (`app/src/context/pipeline-context.tsx`)

- **Type:** Server-Sent Events
- **Trigger:** User clicks "Run" on `/run` page
- **Duration:** Duration of pipeline (can be many minutes)
- **Behavior:** `PipelineProgress` events emitted via `POST /api/pipeline` response stream. The React context maintains state across navigation.

### Clip Pipeline SSE (`app/src/app/api/clip/route.ts`)

- **Type:** Server-Sent Events
- **Trigger:** User submits a clip job via `/clip`
- **Behavior:** `ClipProgress` events streamed. If the client disconnects, the pipeline continues running (detached). The in-memory progress store allows reconnecting clients to see the current state. `/clip/[jobId]` polls `GET /api/clip/[jobId]` (which returns live progress) until the job reaches a terminal state.

### Clip Export SSE (`api/clip/[jobId]/[clipId]/export`)

- **Type:** Server-Sent Events
- **Trigger:** User clicks "Export" in the clip editor
- **Behavior:** Progress events emitted during the two-pass FFmpeg render

### Outreach Analyze SSE (`api/outreach/analyze`)

- **Type:** Server-Sent Events
- **Trigger:** User initiates bulk analysis
- **Events:** `{ phase: "analyzing"|"generating"|"done"|"error", completed, total, lastId, lead }`
- **Behavior:** Runs in batches of 3 concurrent leads; persists after each batch; stream stays open even if the dialog is closed

### Scheduled Post Processor (in-process)

- **Type:** `setInterval` (60s)
- **Started by:** `instrumentation.ts` on Next.js server start (Node runtime only)
- **Logic:** `processDuePosts()` — fetches all `status:"scheduled"` posts whose `scheduledFor <= now`; skips if `enableSocialPublish=false` or no public HTTPS URL; publishes via `publishReel()`.
- **Re-entrancy guard:** `running` boolean prevents overlapping executions.

### Bulk Downloader Queue Runner (in-process)

- **Type:** `setInterval` (2s)
- **Started by:** First call to `queueRunner.ensureStarted()` (triggered on any `GET /api/downloader/queue` or queue mutation)
- **Logic:** Checks available concurrency slots; starts downloads for "waiting" jobs; processes jobs through inspect → download → ingest phases.
- **Hot-reload safety:** Stored on `global.__dlRunner`; survives Next.js hot-reloads in dev.

### Worker — Campaign Runner

- **Type:** `setInterval` (5 minutes)
- **Process:** In-process with the web server (`app/src/lib/worker/index.ts`, started from `app/src/instrumentation.ts`)
- **Logic:** For each running campaign, acquires a row lock and generates `upload_jobs` rows for the next batch of unprocessed videos × accounts, advancing the cursor.

### Worker — Publisher

- **Type:** `setInterval` (15 seconds)
- **Process:** Separate Node.js process
- **Logic:** Claims up to 5 queued jobs per tick; executes the full IG publish flow; handles retries (max 3); recovers orphaned jobs.

### Worker — Token Refresh

- **Type:** `setInterval` (60 minutes)
- **Process:** Separate Node.js process
- **Logic:** Finds IG accounts with tokens expiring within 14 days; calls `graph.instagram.com/refresh_access_token` to extend them.

---

## 9. Current Database / Storage Model

### Supabase Tables (Publishing System, prefix `pub_`)

#### `pub_storage_objects`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| provider | text | always "r2" |
| bucket | text | R2 bucket name |
| key | text | Object key (e.g. `videos/abc.mp4`) |
| mime_type | text | |
| size_bytes | bigint | |
| checksum | text | SHA-256 hex; used for deduplication |
| version | int | |
| is_current | boolean | |
| created_at | timestamptz | |
| deleted_at | timestamptz | soft delete |

#### `pub_instagram_accounts`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ig_user_id | text UNIQUE | Instagram user ID |
| username | text | |
| display_name | text | |
| access_token | text | long-lived (~60 days) |
| token_expires_at | timestamptz | |
| status | text | connected / needs_reauth / disconnected |
| last_posted_at | timestamptz | |
| created_at | timestamptz | |

#### `pub_videos`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| storage_object_id | uuid → pub_storage_objects | |
| thumbnail_object_id | uuid → pub_storage_objects | |
| title | text | |
| creator | text | |
| platform | text | youtube / instagram / unknown |
| duration_sec | int | |
| original_url | text | |
| storage_status | text | available / deleted |
| publish_status | text | unpublished / scheduled / published |
| downloaded_at | timestamptz | |

#### `pub_video_captions`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| video_id | uuid → pub_videos | CASCADE delete |
| platform | text | default "instagram" |
| language | text | default "en" |
| caption | text | |
| created_at | timestamptz | |
| UNIQUE | (video_id, platform, language) | |

#### `pub_campaigns`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| status | text | draft / ready / scheduled / running / paused / completed / cancelled |
| caption_prompt_template | text | optional |
| assignment_mode | text | crosspost / distribute |
| schedule_rule | jsonb | `ScheduleRule` object |
| timezone | text | |
| starts_at | timestamptz | |
| created_at / updated_at | timestamptz | |

#### `pub_campaign_runner_state`

| Column | Type | Notes |
|---|---|---|
| campaign_id | uuid PK → pub_campaigns | |
| cursor | int | position in video list (last processed) |
| last_tick | timestamptz | |
| locked_until | timestamptz | distributed lock |
| worker_id | text | which worker holds the lock |

#### `pub_campaign_videos`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_id | uuid → pub_campaigns | CASCADE |
| video_id | uuid → pub_videos | |
| position | int | ordering |
| skipped | boolean | |
| UNIQUE | (campaign_id, video_id) | |

#### `pub_campaign_accounts`

| Column | Type | Notes |
|---|---|---|
| campaign_id | uuid → pub_campaigns | CASCADE |
| account_id | uuid → pub_instagram_accounts | |
| PRIMARY KEY | (campaign_id, account_id) | |

#### `pub_upload_jobs`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_id | uuid → pub_campaigns | nullable |
| video_id | uuid → pub_videos | |
| account_id | uuid → pub_instagram_accounts | |
| scheduled_at | timestamptz | when to publish |
| idempotency_key | text UNIQUE | `{campaign_id}-{video_id}-{account_id}` |
| status | text | queued / preparing / uploading / waiting_for_instagram / publishing / published / failed / cancelled |
| retry_count | int | |
| error_message | text | |
| claimed_by / claimed_at | text / timestamptz | worker concurrency control |
| instagram_container_id | text | |
| instagram_media_id | text | |
| published_at | timestamptz | |
| created_at | timestamptz | |

#### `pub_publish_history`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| job_id | uuid → pub_upload_jobs | |
| video_id | uuid → pub_videos | |
| account_id | uuid → pub_instagram_accounts | |
| instagram_media_id | text | |
| permalink | text | |
| published_at | timestamptz | |
| views_count / likes_count / comments_count / reach | bigint | analytics (future) |
| analytics_fetched_at | timestamptz | null = pending fetch |

#### `app_settings` (single-row preferences)

| Column | Type | Notes |
|---|---|---|
| id | integer PK | always 1 |
| provider | text | openai / openrouter |
| openrouter_model | text | |
| gemini_model | text | |
| linkedin_char_limit | int | |
| email_length_guidance | text | |
| whatsapp_char_limit | int | |
| sender_name | text | |
| default_location_label | text | |
| transcription_provider | text | deepgram / assemblyai / local |
| default_caption_preset | text | |
| default_aspect_ratio | text | |
| default_clip_length | text | |
| ytdlp_cookies_browser | text | nullable |
| ytdlp_cookies_text | text | nullable |
| enable_social_publish | boolean | |
| editor_shortcuts | jsonb | |
| openai_api_key, openrouter_api_key, apify_api_token, deepgram_api_key, assemblyai_api_key, meta_app_id, meta_app_secret | text | DB fallback for keys (env vars take priority) |
| updated_at | timestamptz | |

### File-Based Entity Schemas

**`ClipJob`** — Job configuration snapshot (status, model, aspect ratio, caption preset, range, language, errors)
**`Clip`** — Rendered clip record (id, jobId, rank, score, title, hook, transcript, filePath, thumbnail, caption, starred)
**`ClipEdit`** — Timeline edit document (layout segments, caption config, removed ranges, word styles, text/media overlays, transitions, audio, blurred background)
**`SocialAccount`** — Connected IG account (id, platform, tokens, igUserId, displayName)
**`ScheduledPost`** — Post record (clipId, accountId, caption, scheduledFor, status)
**`CaptionTemplate`** — Visual caption style template (name, CaptionConfig)
**`CaptionPromptTemplate`** — Creator context template (bio, niche, CTA, hashtags, brand voice)
**`ProspectList`** — Contains list metadata + `Prospect[]` array
**`Prospect`** — Full lead record with AI analysis, CRM fields, outreach messages
**`OfferTemplate`** — Agency offer context for message generation
**`Config`** — Pipeline config (analysis instruction, new concepts instruction, category)
**`Creator`** — Competitor Instagram account (username, category, stats)
**`Video`** — Analyzed video result (link, views, analysis, newConcepts, starred)
**`DownloadJob`** — Download queue entry (url, platform, status, progress, title, creator, thumbnail)

---

## 10. Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Conditional | OpenAI API key (required if `provider=openai` in settings) |
| `OPENROUTER_API_KEY` | Conditional | OpenRouter key (required if `provider=openrouter`) |
| `GEMINI_API_KEY` | For pipeline + autoframe | Google Gemini API key |
| `APIFY_API_TOKEN` | For pipeline | Apify scraping token |
| `DEEPGRAM_API_KEY` | For clipping (Deepgram) | Deepgram transcription key |
| `ASSEMBLYAI_API_KEY` | For clipping (AssemblyAI) | AssemblyAI transcription key |
| `YT_DLP_PATH` | For clipping/downloader (Windows) | Full path to yt-dlp binary; defaults to `yt-dlp` on PATH |
| `YTDLP_COOKIES` | For YouTube downloads | Netscape cookies.txt content; overrides settings textarea |
| `YTDLP_COOKIES_BROWSER` | For local dev | Browser name for `--cookies-from-browser` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (prod) | Supabase project URL (baked into client bundle) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (prod) | Supabase anon key |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes (some paths) | Alias for anon key used by `lib/db/client.ts` |
| `SUPABASE_URL` | Yes (file repos) | Supabase URL (server-side client) |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service role key for server client (`lib/db/client.ts`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key for `lib/supabase.ts` |
| `STORAGE_BACKEND` | Yes | `file` or `supabase`; selects repo implementation |
| `STORAGE_PROVIDER` | No | Object storage provider; defaults to `r2` |
| `R2_ENDPOINT` | Yes (R2) | Cloudflare R2 S3-compatible endpoint URL |
| `R2_ACCESS_KEY_ID` | Yes (R2) | R2 access key |
| `R2_SECRET_ACCESS_KEY` | Yes (R2) | R2 secret access key |
| `R2_BUCKET_NAME` | Yes (R2) | R2 bucket name |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk public key |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Yes | Clerk sign-in redirect path (`/sign-in`) |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Yes | Clerk sign-up redirect path (`/sign-up`) |
| `META_APP_ID` | For IG publishing | Meta/Instagram App ID (overrides DB setting) |
| `META_APP_SECRET` | For IG publishing | Meta/Instagram App Secret |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | For IG publishing | Public HTTPS URL for OAuth redirect + media serving |
| `CLIP_RENDER_CONCURRENCY` | No | Max concurrent FFmpeg renders (default: 1) |
| `CLIP_FFMPEG_THREADS` | No | FFmpeg thread limit per encode (default: 2) |
| `WORKER_ID` | No (worker) | Unique worker ID for distributed lock (default: `worker-1`) |

---

## 11. Application Flow

### Flow 1: Content Intelligence (Competitor Analysis)

1. User opens `/run`, selects a Config and sets max-videos / top-K / nDays
2. User clicks "Run Pipeline" → browser calls `POST /api/pipeline` (SSE)
3. Server-side: `runPipeline()` starts
4. **Scraping phase:** For each creator (2 concurrent), `scrapeReels()` calls Apify → receives reel list
5. Filter by date cutoff, sort by views, take top-K per creator
6. **Analysis phase:** For each top video (1 at a time):
   - `fetch(video.videoUrl)` → download buffer
   - `uploadVideo()` → Gemini File API
   - `analyzeVideo()` → structured analysis text
   - `generateNewConcepts()` → OpenAI/OpenRouter adapted concepts
7. `repos.videos.appendBatch()` → writes to `videos.csv` (or Supabase)
8. SSE stream closes; browser redirects to `/videos`

---

### Flow 2: Clip Generation

1. User opens `/clip`, pastes a URL (or uploads a file), configures settings
2. On URL paste: `POST /api/clip/inspect` → yt-dlp `--dump-single-json` → title/duration shown
3. User clicks "Create clips" → browser calls `POST /api/clip` (SSE)
4. Server-side: `runClipPipeline()` starts
5. **Download:** `downloadVideo()` → yt-dlp downloads to `os.tmpdir()/social-clipper/{jobId}/source.mp4`; copied to `data/clips/source-{jobId}.mp4`
6. **Transcribe:** FFmpeg extracts mono 16kHz mp3 → Deepgram/AssemblyAI → `Word[]` array; saved to `data/clip-transcripts/{jobId}.json`
7. **Select moments:** `selectMoments()` → LLM prompt with timestamped transcript → `Moment[]`
8. **Render each moment:** `renderClip()` → FFmpeg: seek → cover-crop reframe → burn `.ass` captions → output mp4 + JPEG thumbnail to `data/clips/`
9. Clips sorted by score; appended to `clips.csv` (or Supabase); job marked "done"
10. SSE stream closes; user redirected to `/clip/{jobId}` results page

---

### Flow 3: Clip Editing + Export

1. User opens `/clip/[jobId]/[clipId]/edit`
2. Browser loads `ClipEdit` from `GET /api/clip/[jobId]/[clipId]/edit` (or seeds a default)
3. All changes auto-saved via debounced `PUT /api/clip/[jobId]/[clipId]/edit`
4. User can trim segments, cut speech, add captions/overlays, choose transitions, adjust frame
5. User clicks "Export" → `POST /api/clip/[jobId]/[clipId]/export` (SSE)
6. `exportEdit()`:
   - Pass 1: speech-cut + reframe + transitions + audio → temp mp4
   - Pass 2: burn captions + text overlays + audio mix → `{clipId}-edited.mp4`
7. `clips.csv` updated: `filePath` now points at the edited file
8. Preview video in results page updates

---

### Flow 4: Scheduling a Clip to Instagram

1. User opens clip results `/clip/[jobId]`; clicks "Schedule" on a clip
2. Schedule modal opens; user selects account + date/time + caption template
3. User generates AI caption: `POST /api/clip/social/caption` → LLM fills in creator context + clip variables
4. User clicks "Schedule" (or "Publish now") → `POST /api/clip/social/schedule`
5. `ScheduledPost` record created with `status: "scheduled"` (or `"draft"` for immediate)
6. **Immediate publish:** if `scheduledFor` absent and `enableSocialPublish=true`, `publishReel()` called inline → `status: "published"`
7. **Scheduled publish:** The in-process scheduler (`setInterval(60s)`) checks every minute; when `scheduledFor <= now`, calls `publishReel()` → updates status

---

### Flow 5: Bulk Download → Video Library

1. User opens `/downloader`, pastes YouTube/Instagram URLs
2. Browser calls `POST /api/downloader/queue` → `queueRunner.addJobs()`
3. Background tick (every 2s): jobs flow through inspecting → downloading → uploading phases
4. **Ingest:** `ingestVideo()` computes SHA-256 checksum, checks for duplicate in `storage_objects`, uploads to R2, inserts `pub_videos` row
5. Browser polls `GET /api/downloader/queue` every 2s to show progress
6. Completed videos appear in `/library`; signed R2 URLs generated on request

---

### Flow 6: Campaign Publishing

1. User opens `/campaigns/new`; creates campaign with schedule rule (frequencyHours, windowStart/End, timezone, randomizeMinutes)
2. User adds videos + accounts; clicks "Publish" → `POST /api/campaigns/[id]/publish`
3. Campaign status → "running"; `campaign_runner_state` row created with cursor=0
4. **Worker (every 5 min):** `runCampaignRunnerTick()` → acquires row lock on campaign → generates `upload_jobs` for next batch of videos × accounts with computed `scheduled_at` times
5. **Worker (every 15 sec):** `runPublisherTick()` → claims up to 5 due jobs → for each:
   - Get signed R2 URL for video
   - Create IG Reel container
   - Poll until `FINISHED`
   - Publish container → get `mediaId`
   - Insert `publish_history` row (idempotency fence)
   - Update job status to "published"
6. Campaign completes when all videos are processed (cursor reaches end)

---

### Flow 7: Lead Intelligence (Outreach)

1. User opens `/outreach/prospects`; clicks "Import" → uploads Google Maps or LinkedIn CSV
2. `POST /api/outreach/import` → detect source → map columns → create `ProspectList` with all leads at `leadStatus:"new"`, `analysisStatus:"idle"`
3. User selects leads and clicks "Analyze" → `POST /api/outreach/analyze` (SSE)
4. **Phase 1 (analyzing, 3 concurrent):** For each lead, LLM returns `priorityScore`, `businessCategory`, `reviewSummary`, `websiteStatus`, `outreachAngle`; `levelFromScore()` maps score to level
5. **Phase 2 (generating, 3 concurrent):** For each lead (with active `OfferTemplate`), LLM returns `whatsappMessage`, `emailMessage`, `coldCallNotes`
6. Persist after each batch; SSE events sent for each completed lead
7. User views leads in table; can filter/sort by priority/status; click lead → detail sheet with messages

---

## 12. Current Features

### Fully Implemented

**Content Intelligence:**
- Competitor Reel scraping via Apify
- Gemini video analysis with custom per-config instruction
- OpenAI/OpenRouter concept generation
- Config CRUD (name, analysis instruction, concepts instruction, category)
- Creator CRUD + refresh stats
- Video browser with thumbnails, expandable analysis + concepts
- Star/unstar videos

**Clipping Pipeline:**
- URL ingestion (yt-dlp) + file upload (up to 500 MB)
- Deepgram + AssemblyAI transcription
- LLM moment selection with virality scoring
- FFmpeg render: cover-crop reframe (9:16 / 1:1 / 16:9), karaoke caption burn, first-5s hook overlay
- Caption presets (Karaoke, Beasty, Minimal, etc.)
- Speech language selection (6 languages + Hinglish)
- Genre + clip length configuration
- Custom timeframe (range slider)
- "Include moments" custom prompt
- Cancellation during pipeline
- Job persistence (survive browser reload)
- Clip projects list + results grid
- Clip download (mp4)
- Clip starring

**Clip Editor:**
- Timeline with filmstrip track + audio waveform
- Drag-scrub playback; Ctrl+wheel zoom
- Speech cuts (remove ranges) via transcript panel
- Segment split, trim (drag in/out), delete
- Fill/Fit/Crop mode per segment
- Aspect ratio selection (9 options including custom)
- Video-as-object reframe: drag to reposition, corner-drag to scale, magnetic snapping with cyan guides
- Caption config: preset, font (family, size, color, bold, italic, underline, stroke, shadow), effects (position, animation, lines, highlight color)
- Text overlays: drag-positionable, corner-resizable, font/size/color/align/bg/opacity settings
- Transitions: fade/crossfade/crosszoom/zoomin/zoomout; per-marker duration; auto-transitions at cut boundaries
- Word-level transcript: click to seek, drag-select to highlight/edit/delete words
- Word color overrides (highlight colors per word)
- Multi-speaker layouts: split (2), triple (3), quad (4); face-centered crops per pane
- Auto-reframe (Gemini or GPT-4o): classify speaker-present → fill/face-crop vs fit
- Speaker pane detection for multi-speaker layout
- Layer presets (branding overlays): bottom banner, logo, social handle, subtitle, watermark; saved to localStorage
- Auto blurred background for Fit-mode bars
- Configurable keyboard shortcuts
- Undo/redo
- Auto-save (debounced PUT)
- Export (two-pass FFmpeg; SSE progress)

**Instagram / Social:**
- OAuth connect (Instagram Business Login, no Facebook Page required)
- Multi-account support (connect N accounts, deduplicated by `igUserId`)
- Schedule modal: account + date/time selection, tone/format/hashtag controls
- AI caption generation with creator context templates
- Caption prompt templates (creator bio/niche/CTA/hashtags/brand voice; CRUD)
- In-process scheduler (1-min tick) for scheduled posts
- Visual caption style templates (CRUD: create, edit, duplicate, delete)

**Outreach / Lead Intelligence:**
- CSV import (Google Maps + LinkedIn column detection)
- Prospect CRUD + CRM fields (leadStatus, followUpDate, dealValue, priceQuoted, priceConfirmed)
- AI lead scoring (0–100 → hot/high/medium/low) + message generation (WhatsApp/Email/ColdCall)
- Bulk analyze via SSE (3 concurrent, batched persistence)
- Lead table with infinite scroll, row-selection, bulk actions
- Inline-editable priceQuoted/priceConfirmed/note fields
- Filter bar (status, priority, source, search) with localStorage persistence per list
- Lead detail side sheet
- CRM dashboard (9 stat cards, priority distribution chart, pipeline funnel chart)
- Offer templates (CRUD)
- Multiple prospect lists

**Bulk Downloader:**
- Paste YouTube Shorts + Instagram Reel URLs (mixed)
- Profile scrape → auto-add all videos
- Configurable save directory, quality (720p/1080p), concurrent downloads, retries, skip-duplicates
- Real-time progress table (polls every 2s)
- Ingest to R2 + Supabase on completion

**Publishing System (campaigns):**
- Video library (R2-backed; signed URL access)
- Campaign CRUD with schedule rule builder
- Add videos + accounts to campaign
- Schedule preview (first post, last post, estimated duration)
- Campaign publish → worker generates upload_jobs
- Upload job queue viewer
- Publish history viewer
- Worker: distributed locking, retry (up to 3), daily post limit (50/account), crash recovery (orphan reclaim), graceful shutdown (SIGTERM resets in-flight jobs)
- Token refresh worker

**General:**
- Clerk authentication (all routes protected)
- Dark/light theme
- Settings page: all API keys, transcription provider, caption defaults, social settings, editor shortcuts
- Repository abstraction (file vs Supabase switchable via `STORAGE_BACKEND`)
- Atomic file writes (crash-safe)
- Railway Docker deployment

### Partially Implemented

- **Live IG publishing (clipping path):** Code is complete but gated behind `enableSocialPublish=true`. This flag is set in Settings; Meta App Review is needed before the gate can be opened for production use.
- **Video library page (`/library`):** The page reads from the download queue (completed jobs), not from the Supabase `pub_videos` table. The library service (`video-library-service.ts`) is wired up but the page's API route (`api/library`) reads the downloader queue directly.
- **Media/B-roll compositing in export:** Preview supports media overlays; export (`editRender.ts`) does not yet composite them into the ffmpeg output.
- **Analytics collection:** `publish_history` rows have analytics columns (`views_count`, `likes_count`, etc.); `analytics_fetched_at` is tracked. No code currently fetches analytics from the IG API.
- **Caption burning in editRender pass 2 — text overlay backgrounds:** Text overlay position/color/opacity export correctly; background strips do not.

### Experimental

- **Local Whisper transcription:** Listed as a transcription option in Settings but throws `"Local whisper transcription is not wired up in v1"` when selected. Not functional.
- **`assign_mode: "distribute"`** in campaigns: column exists in schema; worker always crossposting behavior; distribute mode is not differentiated in job generation.

### Deprecated / Superseded

- **`lib/settings.ts` file store:** Still used when `STORAGE_BACKEND=file`. Superseded by Supabase `app_settings` table for the production (Railway) deployment.
- **`lib/supabase.ts` (`supabaseServer`):** Used by the publishing system repositories. `lib/db/client.ts` (`serverClient()`) is a second, functionally equivalent Supabase client used by the repo layer. Historical duplication.
- **`app/src/lib/claude.ts`:** Named "claude" but calls OpenAI API. Predates the OpenRouter addition.

---

## 13. Architecture Decisions

### Repository Pattern with Dual Backend

**Decision:** All data access goes through a `repos` object exported from `lib/db/index.ts`. Each entity has two implementations (file and Supabase) behind the same TypeScript interface. `STORAGE_BACKEND` env var switches at module load time.

**Why:** Enabled migration from file-based storage to Supabase without changing any API route or service code. The file backend was the original implementation; Supabase was added incrementally.

**Consequence:** Two parallel implementations must be kept in sync. Adding a new field requires updating both.

---

### SSE for Long-Running Operations

**Decision:** All multi-step operations (pipeline, clip generation, clip export, outreach analyze) stream progress over Server-Sent Events from Next.js API routes.

**Why:** Operations take minutes. HTTP request timeout constraints (and Railway's 5-minute `maxDuration`) make SSE the simplest streaming mechanism. Clients can disconnect and reconnect; the server-side operation continues.

**Consequence:** The clip pipeline keeps live progress in an in-process `Map`. This is lost on server restart; clients must poll `GET /api/clip/[jobId]` to get persisted state.

---

### In-Process Background Processes

**Decision:** The scheduled-post processor and the downloader queue runner run as `setInterval` timers within the Next.js server process, not as a separate worker.

**Why:** Avoids operational complexity of a second process for these lightweight tasks.

**Consequence:** These processes stop when the Next.js server is restarted or crashes. Scheduled posts may be delayed. The downloader runner survives hot-reloads via `global.__dlRunner`.

---

### Atomic File Writes

**Decision:** All JSON and CSV file writes use `writeFileAtomic()` — write to a `.tmp` file then `renameSync()`.

**Why:** Prevents corrupt files on crash mid-write. `rename()` is atomic on the same filesystem, so readers never see a half-written state.

---

### Single ClipEdit Document as Editor Source of Truth

**Decision:** One `ClipEdit` JSON document (one per clip) drives both the browser preview and the FFmpeg export. `edit-timeline.ts` contains the pure time-math shared between them.

**Why:** Ensures export exactly matches preview. No "render surprises" from divergent logic. Adding any new feature requires updating the shared time-math, the preview rendering, and the export rendering — in that order.

---

### Clip Render Concurrency Default = 1

**Decision:** `CLIP_RENDER_CONCURRENCY` defaults to 1 (one FFmpeg encode at a time).

**Why:** Two concurrent libx264 encodes plus the Next.js server can exceed available memory on small Railway containers, causing the OOM killer to SIGKILL ffmpeg. The null-exit-code case is explicitly handled in `ffmpeg.ts` with an actionable error message.

---

### Publishing System Separate from Clip Pipeline

**Decision:** The publishing system (campaigns, video library, upload jobs) uses Supabase and R2 exclusively and lives in separate `lib/db/repositories/` and `lib/services/` directories. The clip pipeline's direct Instagram publishing path (`lib/clip/social/`) is independent.

**Why:** The clip pipeline was built first with a simpler direct-publish flow. The publishing system was added later as a production-grade campaign automation layer. They serve different use cases (one-off clip scheduling vs automated multi-account campaigns).

---

### Cookies for YouTube Downloads

**Decision:** yt-dlp cookies are stored as Netscape-format text (pasted by the user in Settings) and written to a temp file before each yt-dlp invocation. The `YTDLP_COOKIES` env var is the Railway-safe override.

**Why:** Railway's ephemeral filesystem makes the settings textarea unreliable across redeploys; the env var persists. On a server (Railway), `--cookies-from-browser` cannot work (no browser installed). The text format is what yt-dlp requires.

---

### Layer Presets in localStorage

**Decision:** The clip editor's branding layer presets (`LayerPresetsPanel`) are stored in browser localStorage, not on the server.

**Why:** Presets are highly personal to the operator, not tied to any specific clip or job. localStorage is the simplest persistence for purely client-side preference data.

---

## 14. Known Technical Debt

### Two Supabase Clients

`lib/supabase.ts` exports `supabaseServer` (used by publishing system repos). `lib/db/client.ts` exports `serverClient()` (used by the repo layer for clipping/outreach entities). Both are the same connection with the same credentials. They exist because the publishing system was built after the repo abstraction. The two should be unified.

### Library Page reads Download Queue, not pub_videos

`api/library/route.ts` reads `readQueue()` (the downloader's JSON file) instead of calling `videoLibraryService.listVideos()`. This means the Library page only shows downloads from the current process's lifetime and does not reflect what is actually in Supabase/R2. The proper implementation is in `video-library-service.ts` and `video-repository.ts` but is not wired up.

### Campaign Worker uses Unprefixed Table Names

`worker/campaign-runner.ts` queries `campaigns`, `campaign_videos`, `campaign_accounts`, `campaign_runner_state`, `upload_jobs` (without `pub_` prefix). The migration creates these tables as `pub_campaigns`, `pub_campaign_videos`, etc. Either the worker queries the wrong tables, or a view aliases them without the prefix. This is a live inconsistency that requires verification.

### claude.ts calls OpenAI

`lib/claude.ts` is the concept-generation client for the content intelligence pipeline. It calls `openai.chat.completions.create` with `gpt-4o` hardcoded. The name "claude" is stale from a period when the app used Anthropic. It can be renamed or merged into `llm-client.ts`.

### File Backend + Supabase Backend Divergence

Every new field on a clipping or outreach entity must be added to both the file implementation and the Supabase implementation in `lib/db/repos/`. This is easy to forget. There are no integration tests verifying parity.

### No Purge for Orphaned Temp Files

The clip pipeline writes source video and encoded clips to `os.tmpdir()/social-clipper/{jobId}/`. These accumulate over time. The persistent copy at `data/clips/source-{jobId}.mp4` is kept intentionally; the temp dir is never cleaned up.

### In-Memory Progress Cleared on Restart

If the Next.js server restarts while a clip job is running, the in-memory progress Map is lost. The pipeline continues running (it's a Node.js async chain, not a separate process), but clients will only see the persisted job status, not the live log.

### Scheduled Posts Processor is Single-Process

The in-process scheduler (`instrumentation.ts` → `startScheduler()`) runs only in the Next.js process. In a multi-instance deployment, all instances would run the scheduler. The `running` flag prevents overlap within a single process but not across instances.

### Token Refresh Schedule is Fixed

The token refresh interval is 60 minutes and checks for tokens expiring within 14 days. There is no mechanism to refresh a token that expires within hours (e.g., after a redeploy resets the 60-minute timer).

### No Error Recovery for Supabase Settings Write Failure

When `repos.settings.write()` fails (e.g., Supabase down), the `POST /api/settings` route returns a 500. The Settings page should handle this gracefully but the user may not see the error message depending on UI state.

### Editor Keyboard Shortcuts Not Scoped

The `shortcuts.ts` keyboard shortcut handlers may fire even when a text input is focused in the editor. Input elements are not always correctly excluded from shortcut handling.

---

## 15. File Responsibility Index

### Root Level

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `.env` | All secrets and config; loaded by `next.config.ts` at dev time | `dotenv`, `next.config.ts` | Everything that reads `process.env.*` |
| `Dockerfile` | Railway production container; installs yt-dlp, fonts, ffmpeg; builds Next.js | Railway CI/CD | Production deployment |
| `railway.toml` | Railway build + restart policy | Railway | Deployment configuration |
| `CLAUDE.md` | Developer session context; keeps Claude Code sessions informed | Claude Code sessions | Documentation only |

### `app/src/` Core

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `middleware.ts` | Clerk auth enforcement | Next.js runtime (every request) | `@clerk/nextjs` |
| `instrumentation.ts` | Starts scheduler on server boot | Next.js startup | `lib/clip/social/scheduler.ts` |
| `app/layout.tsx` | Root layout wrapping all pages | Next.js | Clerk, ThemeProvider, Sidebar, PipelineProvider, Toaster |
| `lib/types.ts` | Single source of all TypeScript interfaces | Everything | No runtime deps |

### `lib/` Services

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `lib/pipeline.ts` | Content intelligence orchestrator | `api/pipeline/route.ts` | `apify.ts`, `gemini.ts`, `claude.ts`, `repos` |
| `lib/apify.ts` | Apify scraper client | `pipeline.ts` | `APIFY_API_TOKEN` |
| `lib/gemini.ts` | Gemini upload + analyze | `pipeline.ts` | `GEMINI_API_KEY` |
| `lib/claude.ts` | Concept generation (OpenAI gpt-4o) | `pipeline.ts` | `OPENAI_API_KEY` |
| `lib/csv.ts` | Generic CSV read/write | `repos/configs`, `repos/creators`, `repos/videos` | `csv-parse`, `csv-stringify` |
| `lib/outreach.ts` | File-backed prospect lists + templates | `repos/prospects`, `repos/offer-templates` | File system |
| `lib/lead-scoring.ts` | `levelFromScore()` + label constants | `api/outreach/analyze`, `components/outreach/*` | Pure logic, no deps |
| `lib/llm-client.ts` | OpenAI/OpenRouter factory | `api/outreach/draft`, `api/outreach/analyze` | `openai`, `lib/settings.ts` |
| `lib/settings.ts` | File-backed `AppSettings` read/write | `repos/settings (file)` | File system |
| `lib/supabase.ts` | Supabase server/browser client factory | Publishing system repos | `@supabase/supabase-js`, env vars |

### `lib/clip/`

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `clipPipeline.ts` | Pipeline orchestrator | `api/clip/route.ts` | download, transcribe, moments, render, repos |
| `ffmpeg.ts` | Binary resolution + process runner | clip pipeline, downloader, filmstrip, waveform | `ffmpeg-static`, `ffprobe-static` |
| `download.ts` | yt-dlp download + upload save + `cookieArgs` | `clipPipeline.ts`, `downloader/engine.ts` | `ffmpeg.ts` |
| `transcribe.ts` | Deepgram/AssemblyAI transcription | `clipPipeline.ts` | `ffmpeg.ts`, `repos.settings` |
| `moments.ts` | LLM moment selection | `clipPipeline.ts` | `llm.ts` |
| `render.ts` | Single clip FFmpeg render | `clipPipeline.ts` | `ffmpeg.ts`, `captions.ts`, `store.ts` |
| `captions.ts` | `.ass` subtitle file generation | `render.ts`, `editRender.ts` | Pure logic + file write |
| `caption-styles.ts` | Browser caption preview styles | `caption-render.tsx`, `store.ts` | No server deps |
| `editRender.ts` | `ClipEdit` → FFmpeg export | `api/clip/[jobId]/[clipId]/export/route.ts` | `ffmpeg.ts`, `captions.ts`, `edit-timeline.ts`, `repos` |
| `edit-timeline.ts` | Pure time math for editor | `editRender.ts`, `timeline.tsx`, `preview-canvas.tsx` | Pure logic |
| `store.ts` | File-backed job/clip/account/edit/transcript storage | `repos/*` (file backend) | File system, `csv-parse/stringify` |
| `llm.ts` | `chat()` + `extractJson()` for clip LLM calls | `moments.ts`, `api/clip/social/caption/route.ts` | `repos.settings`, OpenAI SDK |
| `autoframe.ts` | Speaker detection (Gemini/GPT-4o) for auto-reframe | `api/clip/[jobId]/[clipId]/autoframe`, `speakers` routes | Gemini API, OpenAI API |
| `face-crop.ts` | Face-centered `CropRect` computation | `autoframe.ts`, `api/clip/*/face-crop/route.ts` | `layout-geom.ts` |
| `layout-geom.ts` | Shared slot geometry for multi-speaker layouts | `face-crop.ts`, `preview-canvas.tsx`, `editRender.ts` | Pure math |
| `filmstrip.ts` | Thumbnail sprite sheet (1fps samples) | `api/clip/[jobId]/filmstrip/route.ts` | `ffmpeg.ts` |
| `waveform.ts` | Audio amplitude envelope | `api/clip/[jobId]/waveform/route.ts` | `ffmpeg.ts` |
| `layer-presets.ts` | Branding overlay preset type definitions | `rail-panels.tsx` | Types only |
| `shortcuts.ts` | Editor keyboard shortcut config + resolver | `use-clip-edit.ts`, `lib/settings.ts` | Types only |
| `social/instagram.ts` | Meta OAuth + Graph API publishing | `api/clip/social/callback`, `api/clip/social/connect`, scheduler | Meta Graph API |
| `social/scheduler.ts` | In-process scheduled-post processor | `instrumentation.ts`, `api/clip/social/process` | `repos`, `instagram.ts` |

### `lib/db/`

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `db/index.ts` | `repos` singleton; switches file vs Supabase | All API routes and services | All repo files |
| `db/client.ts` | Supabase client factory (server + browser) | Supabase repos | `@supabase/supabase-js`, env vars |
| `db/types.ts` | Publishing system TypeScript types | Publishing repos, services, API routes | No runtime deps |
| `db/repos/*.ts` | Per-entity file + Supabase implementations | `db/index.ts` | `lib/settings.ts`, `lib/outreach.ts`, `lib/clip/store.ts` |
| `db/repositories/*.ts` | Publishing system Supabase repositories | `lib/services/*`, campaign/library/accounts API routes | `lib/supabase.ts` |

### `lib/services/`

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `video-ingestion-service.ts` | Upload video to R2 + register in pub_videos | `downloader/queue-runner.ts` | `storage/`, `db/repositories/` |
| `video-library-service.ts` | Fetch library videos with signed URLs | (intended for `api/library`; not yet wired) | `storage/`, `db/repositories/` |
| `campaign-service.ts` | Campaign lifecycle | `api/campaigns/*` routes | `db/repositories/campaign-repository.ts`, `schedule-service.ts` |
| `schedule-service.ts` | Pure schedule math | `campaign-service.ts`, `worker/campaign-runner.ts` | `date-fns`, `date-fns-tz` |

### `lib/downloader/`

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `engine.ts` | Single-job inspect + download | `queue-runner.ts` | `lib/clip/ffmpeg.ts`, `lib/clip/download.ts`, `repos.settings` |
| `queue-runner.ts` | Process singleton; manages concurrency | `api/downloader/queue/route.ts` | `engine.ts`, `scraper.ts`, `store.ts`, `video-ingestion-service.ts` |
| `scraper.ts` | Profile URL → flat playlist of video URLs | `api/downloader/scrape/route.ts` | `lib/clip/ffmpeg.ts` |
| `store.ts` | `data/download-queue.json` + `data/downloader-settings.json` | `queue-runner.ts`, `api/downloader/*` | File system |
| `types.ts` | `DownloadJob`, `DownloaderSettings` types | All downloader files | No runtime deps |

### `lib/storage/`

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `index.ts` | `getStorageProvider()` factory | `video-ingestion-service.ts`, `video-library-service.ts` | `r2.ts` |
| `r2.ts` | Cloudflare R2 S3-compatible implementation | `index.ts` | `@aws-sdk/client-s3`, env vars |
| `types.ts` | `StorageProvider` interface | `index.ts`, `r2.ts` | No runtime deps |

### `worker/`

| File | Why it exists | Who calls it | What depends on it |
|---|---|---|---|
| `index.ts` | Worker entry point; starts 3 interval ticks | npm `worker` script | `campaign-runner.ts`, `publisher.ts`, `token-refresh.ts` |
| `campaign-runner.ts` | Generates `upload_jobs` for running campaigns | `index.ts` (5-min interval) | `worker/lib/supabase.ts`, `schedule-service.ts` |
| `publisher.ts` | Claims + executes upload jobs → Instagram | `index.ts` (15s interval) | `instagram-publisher.ts`, `worker/lib/storage.ts`, `worker/lib/supabase.ts` |
| `instagram-publisher.ts` | Instagram Graph API container/publish helpers | `publisher.ts` | Meta Graph API |
| `token-refresh.ts` | Refreshes expiring IG tokens | `index.ts` (60-min interval) | `worker/lib/supabase.ts` |
| `worker/lib/supabase.ts` | Worker's Supabase client | All worker files | `@supabase/supabase-js`, env vars |
| `worker/lib/storage.ts` | Worker's R2 signed URL helper | `publisher.ts` | `@aws-sdk/client-s3`, env vars |

---

*End of PROJECT_IMPLEMENTATION_REFERENCE.md*
