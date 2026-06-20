# PRD: "Clipping" Feature (Opus-Style Long-Video → Viral Clips)

**Created:** 2026-06-19
**Status:** Ready for implementation
**Target executor:** Claude Code (Opus 4.8)
**Request:** Add a third top-level feature, **Clipping**, alongside the existing **Outreach** and **Content** sections. It ingests a long video (URL or upload), auto-finds the most viral moments, renders vertical captioned clips, scores them for virality, and lets the user download or schedule them to social accounts.

---

## 0. How to use this PRD (for Claude Code)

Implement in the **phases** in §9, in order. Each phase has explicit **files**, **deliverables**, and **acceptance criteria** — do not advance until the acceptance criteria pass. After each phase, update `CLAUDE.md` per the repo's "Maintain This File" rule. Follow existing code conventions exactly: SSE streaming like `app/src/app/api/pipeline/route.ts`, settings via `app/src/lib/settings.ts`, data files under the repo-root `data/` dir, shadcn/ui components, Tailwind, the comment-banner style used in `lib/*.ts`.

Anything tagged **[HUMAN]** requires the repo owner (Aamir) to supply a credential or perform an external setup step — see §2. Do not attempt to bypass these; surface them clearly in the Settings UI and fail gracefully when missing.

---

## 1. Goal & Scope

**Goal:** One-click pipeline — paste a long-form video link, get back ranked, post-ready 9:16 clips with burned-in captions, a virality score, and the ability to download or schedule them.

**V1 in scope:**
- Sidebar "Clipping" section (icon strip + sub-nav panel).
- Landing page with URL input + Upload (Google Drive deferred).
- Parse/preview screen with clip settings (model, genre, length, auto-hook, caption preset, aspect ratio, processing timeframe, "include specific moments" prompt).
- Processing screen with live progress (matches the OpusClip "Fetching → Curation → Processing %" modal).
- Results grid: clip card with virality score, download, edit (stub), schedule buttons + hook/genre tags.
- Persistence of jobs and clips.

**V1 NOT in scope (stub the buttons, wire later):**
- Edit Clip studio (timeline editor).
- Speaker-tracked auto-reframe (use center/face-anchored crop in v1).
- Social scheduling **execution** — build the UI + OAuth scaffolding, but actual publishing depends on **[HUMAN]** Meta app approval (see §2.4). Ship the schedule UI + caption generation; gate publish behind a feature flag.

---

## 2. [HUMAN] What Aamir must provide (credentials & external setup)

This is the critical "human intervention" list. The app cannot create these itself. All keys are stored in `data/settings.json` via the existing settings layer and surfaced in `/settings`.

### 2.1 Video download + processing — no key, but binaries required
- **yt-dlp** and **ffmpeg/ffprobe**. Use npm packages `ffmpeg-static` + `ffprobe-static` (bundled binaries, cross-platform) and either the `yt-dlp` binary on PATH or the `yt-dlp-wrap` npm package that fetches it. **[HUMAN]** confirm these install on the dev machine; if `yt-dlp` won't bundle, Aamir installs it once (`brew install yt-dlp` / `pip install yt-dlp` / winget).
- **Note on ToS:** downloading third-party YouTube/Rumble video may violate platform terms. Keep the **Upload** path as the first-class input for owned content.

### 2.2 Transcription (word-level timestamps) — pick ONE
- **Recommended: Deepgram** → `DEEPGRAM_API_KEY`. Fast, cheap, returns word-level timestamps in one call. **[HUMAN]** create account at deepgram.com, generate key.
- *Alt:* **AssemblyAI** → `ASSEMBLYAI_API_KEY`.
- *Alt (zero marginal cost):* local **whisper.cpp** / **faster-whisper** — no key, but slower and needs a local binary/model. **[HUMAN]** install if chosen.

### 2.3 LLM for moment selection + caption generation — already covered
- Reuse existing `provider` / `openaiApiKey` / `openrouterApiKey` / Gemini settings. Gemini (`lib/gemini.ts`) can also do video-level QA. **No new key needed** unless Aamir wants a dedicated model.

### 2.4 Social scheduling — **the heavy human-intervention item**
The OpusClip screenshots show an "OpusClip post-IG" OAuth consent screen. That is **not** username/password login — it is **Instagram Business Login via the Meta Graph API**. To replicate, Aamir must:
1. **[HUMAN]** Create a **Meta Developer App** at developers.facebook.com → get **`META_APP_ID`** + **`META_APP_SECRET`**.
2. **[HUMAN]** Add **Instagram Graph API** + **Facebook Login** products; configure the **OAuth redirect URI** (e.g. `http://localhost:3000/api/clip/social/callback` for dev).
3. **[HUMAN]** The target Instagram account must be a **Business or Creator** account **linked to a Facebook Page**. Personal accounts cannot publish via API.
4. **[HUMAN]** Request the permissions `instagram_business_basic`, `instagram_business_content_publish` (and for other platforms, their equivalents). **Publishing to others' content requires Meta App Review** — until approved, only accounts with a role on the app (dev/test users) can publish. **This is why V1 ships the UI but gates live publishing behind a flag.**
5. Publishing flow (Graph API): clip must be at a **public HTTPS URL** → `POST /{ig-user-id}/media` (create container, `media_type=REELS`, `video_url`, `caption`) → poll container status → `POST /{ig-user-id}/media_publish`. **[HUMAN]** therefore also needs somewhere to host the rendered mp4 publicly (e.g. an S3/R2 bucket) → optional `MEDIA_PUBLIC_BASE_URL` + storage keys.

> **Implementation guidance:** In V1, build the OAuth connect button, token storage, account list, and AI caption generation. Implement the publish call but keep it behind `ENABLE_SOCIAL_PUBLISH=false` until §2.4 steps 1–4 are done. Document all of this in the Settings UI with inline help text.

### 2.5 Summary table to render in `/settings`
| Setting key | Required for | Who provides |
|---|---|---|
| `deepgramApiKey` (or `assemblyaiApiKey`) | Transcription | [HUMAN] |
| existing LLM keys | Moment selection, captions | already set |
| `metaAppId`, `metaAppSecret` | Social OAuth/publish | [HUMAN] |
| `mediaPublicBaseUrl` (+ storage creds) | IG/TikTok publish | [HUMAN] |
| `enableSocialPublish` (bool flag) | Gate publishing | toggle |

---

## 3. Architecture & where it fits

Clipping is a self-contained vertical mirroring the existing Content pipeline. New code lives under `app/src/lib/clip/` and `app/src/app/clip/`. It reuses: the SSE streaming route pattern, `lib/settings.ts`, `lib/csv.ts` (or JSON) for persistence, `lib/gemini.ts`/LLM clients, and shadcn components.

**Heavy work runs inside the streaming POST route as a background async job** (same model as `runPipeline`), pushing `ClipProgress` events. `export const maxDuration = 300;` as in the pipeline route; if a job exceeds that, persist state and let the client poll a status endpoint. (Queue/worker is a v2 concern — note it, don't build it.)

```
URL/Upload
 └─ download.ts   → source.mp4 + metadata (yt-dlp + ffprobe)
 └─ transcribe.ts → word-level transcript (Deepgram)
 └─ moments.ts    → ranked [{start,end,title,hook,score,reason,genre}] (LLM)
 └─ per top-K moment:
      cut.ts      → segment.mp4 (frame-accurate)
      reframe.ts  → 1080x1920 (v1: center/face crop)
      captions.ts → burned-in karaoke captions (.ass via ffmpeg)
      hook.ts     → optional text hook overlay on first 5s (auto-hook)
 └─ persist → clips.csv + jobs.json; emit ClipProgress
```

---

## 4. Sidebar integration (Panel 1 + Panel 2)

Edit `app/src/components/app-sidebar.tsx`. Add a third entry to `SECTIONS` (Panel 1 = icon strip, Panel 2 = sub-nav). Use the `Scissors` icon from `lucide-react`.

```ts
{
  id: "clipping",
  icon: Scissors,
  label: "Clipping",
  items: [
    { title: "New Clip",  href: "/clip",          icon: Scissors },
    { title: "Projects",  href: "/clip/projects",  icon: Film },
    { title: "Social Accounts", href: "/clip/social", icon: Share2 },
  ],
},
```
Update `getSectionFromPath` to return `"clipping"` when `pathname.startsWith("/clip")`.

---

## 5. Data models (`app/src/lib/types.ts` additions)

```ts
export interface Word { text: string; start: number; end: number; }

export interface Moment {
  start: number; end: number;
  title: string;
  hook: string;            // text-hook line for first 5s
  score: number;           // 0–100 virality estimate
  reason: string;          // why it was picked
  genre: string;           // e.g. "Journey & tutorial"
  hookType: string;        // e.g. "Intrigue hook"
}

export type ClipJobStatus =
  | "idle" | "downloading" | "transcribing" | "selecting"
  | "rendering" | "done" | "error";

export interface ClipJob {
  id: string;
  sourceUrl?: string;
  sourceTitle: string;
  sourceDurationSec: number;
  status: ClipJobStatus;
  // settings snapshot
  clipModel: string;       // "Auto" | "ClipBasic" | ...
  genre: string;           // "Auto" | specific
  clipLengthMode: string;  // "Auto(0-3m)" | "<30s" | "30s-60s" | "60s-90s"
  autoHook: boolean;
  captionPreset: string;   // "Karaoke" | "Beasty" | ... | "No caption"
  aspectRatio: string;     // "9:16" | "1:1" | "16:9"
  speechLanguage: string;  // "English" | ...
  includeMomentsPrompt?: string;
  rangeStartSec: number;   // processing timeframe slider
  rangeEndSec: number;
  createdAt: string;
  errors: string[];
}

export interface Clip {
  id: string;
  jobId: string;
  rank: number;
  title: string;
  start: number; end: number;
  durationSec: number;
  score: number;           // virality
  hook: string;
  hookType: string;
  genre: string;
  filePath: string;        // final captioned vertical mp4 (local)
  publicUrl?: string;      // when uploaded for publishing
  thumbnail: string;
  caption?: string;        // AI-generated social caption
  starred: boolean;
  createdAt: string;
}

export interface ClipProgress {
  jobId: string;
  status: ClipJobStatus;
  sourceTitle?: string;
  curationMethod?: string;          // mirrors "Curation method: ClipBasic..."
  rangeLabel?: string;              // "From 0:00:00 to 0:10:16, 0-180s..."
  etaSeconds?: number;
  percent: number;                  // 0–100 overall
  momentsTotal: number;
  clipsRendered: number;
  log: string[];
  errors: string[];
}

// Social
export interface SocialAccount {
  id: string;
  platform: "instagram" | "tiktok" | "youtube";
  displayName: string;
  username: string;
  avatarUrl?: string;
  accessToken: string;     // store encrypted/at-rest; never expose to client
  igUserId?: string;
  pageId?: string;
  expiresAt?: string;
  connectedAt: string;
}

export interface ScheduledPost {
  id: string;
  clipId: string;
  accountId: string;
  caption: string;
  scheduledFor?: string;   // ISO; absent = publish now
  status: "draft" | "scheduled" | "published" | "failed";
  createdAt: string;
}
```

Persist `clips` in `data/clips.csv` (mirror `videos.csv` handling in `lib/csv.ts`), and `jobs` / `socialAccounts` / `scheduledPosts` as JSON in `data/` (mirror `settings.json`). Add typed read/write helpers in `lib/csv.ts` or a new `lib/clip/store.ts`.

---

## 6. Settings additions

Extend `AppSettings` in `app/src/lib/settings.ts`:
```ts
// Clipping
transcriptionProvider: "deepgram" | "assemblyai" | "local";
deepgramApiKey: string;
assemblyaiApiKey: string;
defaultCaptionPreset: string;
defaultAspectRatio: string;
defaultClipLength: string;
// Social
metaAppId: string;
metaAppSecret: string;
mediaPublicBaseUrl: string;
enableSocialPublish: boolean;
```
Add defaults, then add a "Clipping" + "Social" card to `app/src/app/settings/page.tsx` reusing the existing `KeyInput` component and `Select` model pattern. Include the §2 help text inline.

---

## 7. Feature flow → pages & components (mapped to the screenshots)

### Screen 1 — Landing (`/clip`) [image 1]
- Centered card: link input ("Drop a video link"), **Upload** button, Google Drive (disabled/"coming soon"), primary **"Get clips in 1 click"**, "try a sample project" link.
- On paste of a valid URL → transition to Screen 2 (fetch metadata via a lightweight `POST /api/clip/inspect` that runs `yt-dlp --dump-json` for title/duration/thumbnail).

### Screen 2 — Configure (`/clip` expanded) [images 2,3,4]
- Show fetched thumbnail + title, "Speech language" select, "Upload .SRT (optional)", credit-usage indicator (can be a static estimate in v1).
- **AI clipping** tab with: Clip model select, Genre select, Clip Length select, Auto-hook toggle, "Include specific moments" prompt textarea, **Processing timeframe** dual-range slider (start/end of source), "Don't clip" tab (passthrough).
- **Caption preset** gallery (Quick presets: No caption, Beasty, Youshaei, Mozi, Glitch Infinite, Karaoke, Deep Diver, Pod P, Popline, Seamless Bounce) + **aspect ratio** select + "Save settings as default".
- Primary **"Get clips in 1 click"** → `POST /api/clip` with a `ClipJob` payload → Screen 3.

### Screen 3 — Processing [image 5]
- Modal/overlay consuming the SSE stream. Render lines exactly in the OpusClip spirit: `Fetching video "<title>"`, `Curation method: <model>...`, `From <start> to <end>, preferred clip length of <range>...`, `Estimated waiting time: ~Nmin`, `Processing & analyzing... NN%`. Thumbnail with % + ETA badge. "Close" lets it run in the background (persist job, poll `/api/clip/[jobId]`).

### Screen 4 — Results (`/clip/[jobId]`) [image 6]
- Grid of `ClipCard`s sorted by score desc. Each card: vertical video preview (poster + play), duration badge, **virality score** (big colored number, e.g. 99/92/85), action row: **schedule** (calendar icon), **download** (down arrow), **edit** (scissors) — and below, title + hook/genre tag chips (e.g. "Intrigue hook", "Journey & tutorial").
- "Auto hook" info banner when `autoHook` was on. Top bar: search, Select, Filter, sort, export.
- **Button behaviors (V1):** Download = serve the local mp4. Edit = open stub route `/clip/[jobId]/[clipId]/edit` (placeholder). Schedule = open Schedule modal (Screen 5).

### Screen 5 — Connect + Schedule [images 7,8]
- **Connect (`/clip/social`):** "Add account" → starts Meta OAuth (`GET /api/clip/social/connect?platform=instagram`) → Meta consent screen → `GET /api/clip/social/callback` exchanges code for token, fetches IG business user id + page, saves `SocialAccount`. (This is the consent screen in image 7 — it's Meta's Instagram Business Login, **not** raw username/password.)
- **Schedule modal:** account selector (multi), AI-generated caption box with **Regenerate** (Tone / Format / Mimic / Hashtag controls) generated from the clip's transcript + title via the LLM client, clip preview, **Select time** (schedule) vs **Publish now** (gated by `enableSocialPublish`). Persist `ScheduledPost`. A scheduled task (`mcp`/cron or the repo's scheduler) fires due posts.

---

## 8. Backend modules & API routes

**`app/src/lib/clip/`**
- `download.ts` — `inspect(url)` and `downloadVideo(url)`; `uploadLocal(file)` for the Upload path.
- `transcribe.ts` — provider-switched word-level transcription.
- `moments.ts` — `selectMoments(words, job)`; prompt incorporates genre, clip-length mode, and `includeMomentsPrompt`; returns validated JSON.
- `cut.ts`, `reframe.ts`, `captions.ts`, `hook.ts` — ffmpeg steps (see §3). Caption presets map to `.ass` style templates in `captions.ts`.
- `clipPipeline.ts` — orchestrator with `runWithConcurrency` (copy from `pipeline.ts`) + `onProgress`.
- `store.ts` — read/write `jobs.json`, `clips.csv`, `socialAccounts.json`, `scheduledPosts.json`.
- `social/instagram.ts` — OAuth URL build, token exchange, publish (container → poll → publish).

**`app/src/app/api/clip/`**
- `inspect/route.ts` — POST, returns `{title,durationSec,thumbnail,width,height}`.
- `route.ts` — POST `ClipJob`, SSE stream of `ClipProgress` (mirror `api/pipeline/route.ts`).
- `[jobId]/route.ts` — GET job + clips (for polling/refresh after "Close").
- `download/[clipId]/route.ts` — GET, streams the mp4 with attachment headers.
- `social/connect/route.ts`, `social/callback/route.ts`, `social/accounts/route.ts` — OAuth + account CRUD.
- `social/caption/route.ts` — POST, returns AI caption for a clip.
- `social/schedule/route.ts` — POST, create `ScheduledPost`; publish if `enableSocialPublish`.

---

## 9. Phased implementation plan (execute in order)

### Phase 0 — Scaffolding & deps
- Add deps: `ffmpeg-static`, `ffprobe-static`, `yt-dlp-wrap` (or document binary). Add types, settings fields, sidebar section, empty `/clip` page + nav routes.
- **Acceptance:** app builds; "Clipping" appears in the sidebar with 3 sub-nav items; `/clip` renders a placeholder; `/settings` shows new (empty) Clipping/Social cards.

### Phase 1 — Ingest & inspect
- `download.ts` `inspect()` + `/api/clip/inspect`; landing page paste → Screen 2 with real thumbnail/title/duration. Upload path stores file to a temp dir.
- **Acceptance:** pasting a public URL shows correct title, duration, thumbnail within a few seconds; an uploaded file is accepted and probed.

### Phase 2 — Transcription
- `transcribe.ts` (Deepgram default) returning `Word[]`.
- **Acceptance:** for a 2–3 min source, logs an accurate transcript with sensible word timestamps; missing key surfaces a clear settings error.

### Phase 3 — Moment selection
- `moments.ts` LLM call honoring genre/length/`includeMomentsPrompt`/timeframe; strict JSON parse + validation.
- **Acceptance:** returns a ranked `Moment[]` within the selected timeframe; scores in 0–100; titles/hooks are coherent for a real video.

### Phase 4 — Render one clip end-to-end
- `cut.ts` → `reframe.ts` (center/face crop to 1080×1920) → `captions.ts` (Karaoke preset) → optional `hook.ts`.
- **Acceptance:** one finished 9:16 mp4 with synced burned-in captions and correct audio for the top moment.

### Phase 5 — Orchestrate, stream, persist
- `clipPipeline.ts` + `/api/clip` SSE; processing modal (Screen 3) renders live lines + %; persist `ClipJob` + `Clip[]`; `[jobId]` GET for polling.
- **Acceptance:** one URL → N clips on disk + rows persisted; closing the modal and reopening `/clip/[jobId]` shows progress/results; errors stream cleanly.

### Phase 6 — Results UI
- `/clip/[jobId]` grid with `ClipCard` (score, preview, download/edit/schedule, tag chips), auto-hook banner, sort/filter, `/clip/projects` list.
- **Acceptance:** matches image 6 layout; Download returns the mp4; Edit opens the stub; clips sorted by score.

### Phase 7 — Social connect + schedule UI (publish gated)
- Meta OAuth connect flow, account storage, schedule modal with AI caption + Regenerate, `ScheduledPost` persistence; publish call implemented but behind `enableSocialPublish`.
- **Acceptance:** OAuth round-trip stores an account (with valid Meta app); caption generates from transcript; scheduling persists a post; with publish flag off, UI explains the gating; with a fully approved app + public media URL, a manual test publishes a Reel.

### Phase 8 — Polish & docs
- Caption preset gallery styles, "save as default", credit-estimate display, empty/error states, update `CLAUDE.md` (new pages, lib, commands).
- **Acceptance:** full happy path from paste → clips → download works; `CLAUDE.md` updated.

---

## 10. Notes, risks, and explicit non-goals
- **Auto-reframe is the quality moat and the hard part** — v1 ships center/face crop; speaker-tracking is a separate later effort. Don't block on it.
- **Frame-accurate cuts** require re-encoding (`-ss` after `-i`), not stream-copy.
- **Caption styling** disproportionately drives perceived quality — invest in the `.ass` templates per preset.
- **Long renders** dominate UX — parallelize per-clip rendering with `runWithConcurrency`; queue/worker is v2.
- **Social publishing is blocked on Meta App Review** ([HUMAN], §2.4) — that's expected; ship everything up to the publish call and gate it.
- **Non-goals (v1):** full timeline editor, TikTok/YouTube publish execution, multi-user accounts/billing, Crayo-style synthetic faceless videos.

---

## 11. Definition of Done (v1)
A user opens **Clipping**, pastes a link (or uploads), configures clip settings + caption preset, clicks **Get clips in 1 click**, watches live progress, lands on a results grid of scored vertical captioned clips, and can **download** any clip and open the **schedule** modal with an AI-generated caption. Required keys are entered in **Settings**; social publishing is wired but gated until Meta setup is complete.
