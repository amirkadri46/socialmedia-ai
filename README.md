# Social Media AI Platform

A self-hosted, file-based AI platform for short-form video creation, competitor analysis, and personalized outreach. Built on Next.js 16 with no database — all data lives in flat CSV and JSON files in a `data/` directory.

---

## What This App Does

Three major modules:

1. **Analysis Pipeline** — Scrape competitor Instagram Reels via Apify, analyze them with Google Gemini (multimodal), and generate adapted video concepts for your own content.
2. **Outreach System** — Import LinkedIn prospect CSVs, draft personalized LinkedIn DMs and cold emails via OpenAI, manage offer templates and prospect lists.
3. **Clipping Studio** — Paste a YouTube URL (or upload a video), transcribe it, let an LLM pick the best viral moments, and render vertical MP4s with burned-in captions. Includes a full timeline editor.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript 5) |
| UI | React 19, Tailwind CSS 4, shadcn/ui (Radix UI) |
| Video | ffmpeg-static, ffprobe-static, yt-dlp |
| AI (video analysis) | Google Gemini 2.5 Flash (multimodal) |
| AI (outreach + clips) | OpenAI GPT-4o or OpenRouter (DeepSeek V4 Flash default) |
| Transcription | Deepgram or AssemblyAI (word-level timestamps) |
| Scraping | Apify (Instagram Reels) |
| Social Publishing | Meta Graph API (Instagram OAuth, gated by flag) |
| Storage | Flat files — CSV + JSON in `data/` directory |

No database. No user auth (single-user local app). Docker-friendly.

---

## Directory Structure

```
social-media-main/
├── app/
│   └── src/
│       ├── app/            # Next.js pages and API routes
│       ├── lib/            # Business logic (pipeline, outreach, clip, settings)
│       ├── components/     # React components
│       ├── context/        # React context providers
│       └── hooks/          # Custom React hooks
├── data/                   # All persistent data (not committed in prod)
│   ├── settings.json
│   ├── configs.csv
│   ├── creators.csv
│   ├── videos.csv
│   ├── clips.csv
│   ├── clip-jobs.json
│   ├── outreach-lists.json
│   ├── outreach-templates.json
│   ├── social-accounts.json
│   ├── scheduled-posts.json
│   ├── clip-transcripts/   # Word-level transcript JSON per job
│   ├── clip-edits/         # ClipEdit JSON documents per clip
│   ├── clips/              # Rendered MP4s + thumbnails
│   └── csv/                # Exported prospect CSVs
└── plans/                  # Implementation plans / PRDs
```

---

## Pages and Routes

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/` or `/videos` | Stats, recent analyzed reels |
| Videos Browser | `/videos` | All analyzed reels with AI-generated concepts |
| Run Pipeline | `/run` | Run competitor analysis with live SSE progress |
| Configs | `/configs` | Manage analysis configs (prompts, category, active toggle) |
| Creators | `/creators` | Instagram competitor accounts, bulk CSV import |
| Prospects | `/outreach/prospects` | Import CSVs, draft DMs/emails, notes |
| Templates | `/outreach/templates` | Manage offer templates for outreach |
| New Clip | `/clip` | Paste URL or upload, configure and run clip pipeline |
| Projects | `/clip/projects` | All clip jobs with status |
| Clip Results | `/clip/[jobId]` | Scored clip grid, download, edit, schedule |
| Clip Editor | `/clip/[jobId]/[clipId]/edit` | Full timeline editor |
| Social Accounts | `/clip/social` | Connect Instagram for publishing |
| Settings | `/settings` | API keys, clip defaults, editor shortcuts |

---

## Outreach System

This is the primary active feature. Here is how everything works end to end.

### Data Models

**Prospect** (stored inside a ProspectList):

```
id
fullName
firstName
headline          - LinkedIn job title line
company
jobTitle
location
profileUrl
email
bio
website
followers
customNotes       - user-written notes, auto-saved with debounce
linkedinMessage   - AI-drafted LinkedIn DM
emailMessage      - AI-drafted cold email
draftStatus       - idle / drafting / done / error
lastDraftedAt
source            - csv or apify
rawData           - unmapped CSV columns preserved here
```

**ProspectList**: contains id, name, createdAt, and an array of Prospects.
Stored in: `data/outreach-lists.json`
CSV export copy at: `data/csv/{list-name}-{id-prefix}.csv`

**OfferTemplate**: contains id, offerName, whatYouSell, channelFocus (LinkedIn/Instagram/X/Email), valueProps array, tone, cta, proofPoints, dosAndDonts, isActive.
Stored in: `data/outreach-templates.json`

---

### CSV Import Flow

The user imports a LinkedIn connections export or Sales Navigator CSV. The flow is a 3-step wizard.

**Step 1 — Upload and Parse** (POST /api/outreach/import)
- Parses CSV using csv-parse
- Auto-detects column headers
- Runs FIELD_ALIASES mapping — handles 70+ LinkedIn column name variants (e.g. "Contact Email", "Email Address", "Primary Email" all map to the email field)
- Returns: headers, row count, first 5 rows as preview, suggested field mapping

**Step 2 — Column Mapping (client-side)**
- User sees a form: CSV column → Prospect field
- Unmapped columns are kept in rawData so no data is lost

**Step 3 — Save** (POST /api/outreach/lists)
- Creates a new ProspectList with all mapped Prospects
- Persists to data/outreach-lists.json
- Writes a CSV export copy to data/csv/

---

### Template System

- One template can be marked isActive at a time
- The active template is automatically injected into every draft generation prompt
- Managed at /outreach/templates
- A default template is auto-created on first app run if none exist

---

### Draft Generation Flow

This is the core outreach feature: turning prospect data plus your offer template into personalized LinkedIn DMs and cold emails via LLM.

**1. User selects prospects in the table and clicks "Draft selected"**

**2. Client sends batches to POST /api/outreach/draft**
- Runs 3 concurrent requests at a time (rate limit protection)
- Each request includes:
  - Active template context (offer, value props, tone, CTA, proof points, dos/don'ts)
  - Prospect data (name, headline, company, location, bio, email, custom notes)
  - LinkedIn character limit from settings (default: 200)

**3. LLM call (OpenAI GPT-4o or OpenRouter DeepSeek)**
- Prompt instructs the model to output both a LinkedIn DM and a cold email
- Output is parsed as JSON: { linkedinMessage, emailMessage }
- Strict formatting rules enforced in the prompt (no placeholders, no generic openers, no "I hope this finds you well")

**4. Character limit enforcement (LinkedIn only)**
- If the drafted LinkedIn DM exceeds the character limit, single retry with stricter "make it shorter" prompt
- Final fallback: server hard-truncates the string

**5. Result persisted back to the prospect**
- draftStatus set to "done", messages stored on the prospect object, lastDraftedAt set
- If LLM call fails: draftStatus set to "error"
- All changes written back to data/outreach-lists.json

**6. Frontend updates in real time**
- Progress bar across the batch
- Status badge per row updates live (Idle / Drafting / Done / Error)
- Right-side drawer opens to show and edit the drafted messages

---

### Outreach UI Features

- Table view: Name, headline, company, location, draft status badge, inline notes field
- Notes: Inline text field, auto-saves with 800ms debounce — no save button needed
- Side panel (right drawer): Full edit of LinkedIn DM and cold email, with live character counter for LinkedIn
- Copy buttons: One-click copy of each drafted message
- Batch actions: Select multiple rows with checkboxes, draft all selected with progress bar
- Search and filter: Filter by name/company/headline text or by draft status
- Per-list navigation: Sidebar lists all ProspectLists, click to switch between them

---

### Outreach API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET / POST | /api/outreach/lists | List all ProspectLists or create a new one |
| GET / PATCH / DELETE | /api/outreach/lists/[id] | Get, update, or delete a ProspectList |
| GET / POST | /api/outreach/templates | List all templates or create a new one |
| PUT / DELETE | /api/outreach/templates/[id] | Update or delete a template |
| POST | /api/outreach/import | Parse CSV upload, return field mapping suggestion |
| POST | /api/outreach/draft | Generate AI drafts for a batch of prospects |

---

## Analysis Pipeline

1. Creators — Add competitor Instagram handles at /creators
2. Configs — Create a config with your analysis prompt (what to extract) and concept prompt (how to adapt it), set it active
3. Run Pipeline — At /run, select config, set parameters (max videos, top-K, days back), click Run
4. Live Progress — SSE stream shows scrape, analyze, and concept steps with percentages
5. Results — Browse at /videos; each reel shows AI analysis breakdown and adapted concept ideas

Pipeline orchestration lives in lib/pipeline.ts. Apify scrapes reel metadata and thumbnails; Gemini handles multimodal video analysis; OpenAI/OpenRouter generates adapted concepts.

---

## Clipping Studio

### Pipeline Steps

1. Download — yt-dlp downloads from URL, or user uploads a file directly via multipart form
2. Transcribe — ffmpeg extracts audio as WAV; Deepgram or AssemblyAI returns word-level timestamps
3. Select Moments — LLM reads the full transcript and picks top-K viral moments (each scored 0-100) based on genre, hook strength, and length preferences
4. Render — One ffmpeg pass per moment: trim, reframe to aspect ratio, burn captions (ASS subtitle format) and hook text overlay
5. Persist and Stream — Results saved to CSV/JSON; progress streamed via SSE so client can disconnect and reconnect to a running job

### Clip Editor

The editor stores a single ClipEdit JSON document per clip (data/clip-edits/{clipId}.json). Both the browser live preview and the ffmpeg export are pure functions of this document — no divergence between what you see and what you render.

Key editor capabilities:
- Preview canvas: Live HTML5 video + canvas composite with drag-to-pan and corner-resize handles
- Timeline: Scrub bar, zoom, segment chips, trim handles, filmstrip track, waveform amplitude envelope
- Transcript panel: Click any word to seek, drag-select words, per-word color and text overrides
- Captions panel: Presets (Karaoke, Beasty, etc.), font, color, highlight effects
- Speech cleanup: Mark filler words or pauses for removal; timeline re-maps time around the gaps
- Multi-speaker layouts: Split/triple/quad pane layouts with independent crop per speaker
- Auto-reframe: Gemini Flash analyzes sampled frames, classifies speaker presence, auto-builds Fill/Fit segments
- Transitions: Fade, crossfade, crosszoom, zoomin, zoomout between segments
- Audio: B-roll audio tracks, mute base video audio, per-track mix levels
- Export: Two-pass ffmpeg (speech cleanup, transitions, and reframe first — then caption burn)

---

## Settings and Required API Keys

All stored in data/settings.json, managed at /settings.

| Key | Purpose |
|-----|---------|
| openaiApiKey | GPT-4o for outreach drafting and clip moment selection |
| openrouterApiKey | Alternative LLM provider (DeepSeek V4 Flash is the default model) |
| GEMINI_API_KEY (env var) | Gemini 2.5 Flash for video analysis and auto-reframe |
| apifyApiToken | Instagram Reels scraping for competitor analysis |
| deepgramApiKey | Word-level transcription with timestamps (recommended) |
| assemblyaiApiKey | Alternative transcription provider |
| metaAppId / metaAppSecret | Instagram OAuth for social publishing (off by default) |
| linkedinCharLimit | Max LinkedIn DM length enforced by the draft prompt (default: 200) |
| ytDlpCookiesBrowser | Local-only: browser for yt-dlp cookie extraction. Does not work on Railway/servers (no browser installed) |
| ytDlpCookiesText | Pasted YouTube cookies.txt (Netscape format) passed to yt-dlp via `--cookies`. The fix for "Sign in to confirm you're not a bot" on hosted deploys; takes priority over the browser option |

---

## Long-Running Tasks

The analysis pipeline, clip pipeline, and clip export all use Server-Sent Events (SSE) for progress streaming:
- Client connects to a streaming endpoint and receives events with percent, log message, and ETA
- If the client disconnects (tab closed, modal dismissed), the task keeps running on the server
- Client can reconnect with the same job ID and re-attach to the live progress
- Cancellation: client calls a /cancel endpoint which sets an in-memory flag; the running pipeline polls this flag between steps

---

## Running Locally

```
cd app
npm install
npm run dev
```

App runs at http://localhost:3000. Add API keys in Settings before using any AI features. yt-dlp must be installed and on PATH (or set YT_DLP_PATH env var) for URL-based clipping to work.
