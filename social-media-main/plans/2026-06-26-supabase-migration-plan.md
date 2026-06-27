# Supabase Migration Plan — Social Media AI

**Date:** 2026-06-26
**Status:** Architecture & planning only. No code is written until the pre-implementation checklist (§11) is complete.

**Decisions confirmed with you:**
1. **User model:** Internal / single-operator tool. Auth and RLS are *optional hardening*, not core requirements.
2. **Runtime:** Undecided → my recommendation is **stay on the Railway container** (reasoning in §3.6). Supabase becomes the data + storage layer, *not* the compute layer.
3. **Data scope:** Migrate **everything** — all rows and the 369 MB of clip media.

---

## 1. What the app is today (architecture & data flow)

The app is a single Next.js 16 (App Router) server, deployed as a Docker container on Railway with a **persistent volume mounted at `data/`**. There is **no authentication and no concept of users** — it assumes one operator and one process. It runs four loosely-coupled verticals:

- **Analysis pipeline** — scrape Instagram competitors (Apify) → rank → analyze (Gemini) → generate concepts (OpenAI/OpenRouter) → append to `videos.csv`.
- **Outreach / Lead Intelligence** — import Google Maps / LinkedIn CSVs → AI scoring + message generation → CRM pipeline.
- **Clipping pipeline** — `yt-dlp` download → transcribe (Deepgram/AssemblyAI) → LLM moment selection → ffmpeg render → ranked vertical clips.
- **Clip editor** — timeline editor whose single source of truth is one `ClipEdit` JSON doc per clip; both browser preview and ffmpeg export are pure functions of it.

### 1.1 Storage inventory (everything that must move)

| Current store | Path | Shape | Rows / size | Sensitivity |
|---|---|---|---|---|
| Configs | `data/configs.csv` | tabular | 342 | — |
| Creators | `data/creators.csv` | tabular | 53 | — |
| Videos | `data/videos.csv` | tabular (big text cols) | 1,747 | — |
| Clips | `data/clips.csv` | tabular | 29 | — |
| Prospect lists + prospects | `data/outreach-lists.json` | **nested** lists→prospects | 966 KB (one big array) | leads' PII |
| Per-list CSV exports | `data/csv/*.csv` | derived export | — | regenerable |
| Offer templates | `data/outreach-templates.json` | array | small | — |
| Clip jobs | `data/clip-jobs.json` | array | small | — |
| Social accounts | `data/social-accounts.json` | array | small | **OAuth access tokens (plaintext)** |
| Scheduled posts | `data/scheduled-posts.json` | array | small | — |
| Caption templates (style) | `data/caption-templates.json` | array | small | — |
| Caption prompt templates | `data/caption-prompt-templates.json` | array | small | — |
| Clip edits | `data/clip-edits/{clipId}.json` | one doc per clip | 11 files | — |
| Clip transcripts | `data/clip-transcripts/{jobId}.json` | word timings | 5 files | — |
| App settings | `data/settings.json` | single object | — | **API keys (plaintext)** |
| Rendered clips + thumbnails | `data/clips/*.mp4`, `*.jpg`, `*-edited.mp4` | binary | **366 MB** | — |
| Per-clip editor assets | `data/clips/assets/{clipId}/*` | binary | 6.6 MB | — |
| Source videos | `os.tmpdir()/social-clipper/{jobId}/source.mp4` | binary | **ephemeral** | — |

### 1.2 Data-access patterns (what the migration has to preserve)

All data access is funneled through four synchronous modules, which is good news — they are the seam to swap out:

- `lib/csv.ts` — configs / creators / videos (read all, rewrite all).
- `lib/outreach.ts` — prospect lists + templates (JSON read/rewrite of the *entire* 966 KB file on every change).
- `lib/clip/store.ts` — clip jobs, clips, accounts, posts, edits, transcripts, caption templates, plus an **in-memory** `Map` for live job progress and a `Set` for cancellation.
- `lib/settings.ts` — settings object.

Three structural facts drive the whole plan:

1. **Every write rewrites a whole file.** A single lead status change rewrites all 966 KB of `outreach-lists.json`. This is the biggest correctness and performance liability and the clearest win from Postgres.
2. **Reads are synchronous (`readFileSync`).** Moving to a network DB makes the data layer **async**. This is the single largest code change — every call site must `await`.
3. **The clip pipeline is stateful compute.** It shells out to `ffmpeg`/`yt-dlp`, runs *detached* after the client navigates away, streams large MP4s from disk with HTTP range support, and keeps live progress in a process-local `Map` (lost on restart). None of this can run inside Supabase.

---

## 2. What should — and should not — migrate

**Migrate to Supabase Postgres:** configs, creators, videos, clips, prospect lists, prospects, offer templates, clip jobs, social accounts, scheduled posts, caption templates, caption prompt templates, clip edits (as JSONB), transcripts (as JSONB), and the non-secret parts of settings.

**Migrate to Supabase Storage:** rendered clip MP4s, edited MP4s, thumbnails, per-clip editor assets, and — recommended as a fix — source videos.

**Do NOT migrate into Supabase:** the ffmpeg/yt-dlp processing, the detached background jobs, the SSE streaming endpoints, and the raw third-party API calls (Gemini, OpenAI/OpenRouter, Apify, Deepgram/AssemblyAI, Meta). These stay in the Next.js server on Railway.

**Stop storing in any database:** raw API keys and OAuth tokens in plaintext. These move to environment variables (or Supabase Vault) — see §3.5 and §7.

---

## 3. Recommended Supabase architecture (feature by feature)

The mental model: **Supabase replaces the `data/` folder, not the server.** Your Next.js API routes stay; only the *implementation* behind the four storage modules changes from `fs` calls to Supabase calls.

### 3.1 Supabase PostgreSQL — **YES, the core of the migration**

This is where the value is. All tabular and document data lands here (schema in §5). Because the app is server-side and internal, every query runs from your API routes using the **secret key** over the pooled connection. You immediately get: per-row updates (no more whole-file rewrites), indexes and filtering pushed into SQL (the leads table is begging for this), concurrency safety, and JSONB for the genuinely document-shaped data (`ClipEdit`, transcripts, `rawData`, `coldCallNotes`).

Two valid client choices, both fine:
- **`supabase-js` with the secret key** (recommended) — one client for DB + Storage + Auth, least friction.
- **Drizzle or Prisma over the pooled connection string** — better type-safe SQL if you prefer it for the relational tables; you'd still use `supabase-js` for Storage. Don't run both ORMs; pick one.

### 3.2 Supabase Auth — **Optional. Minimal or skip.**

You said internal/single-operator, so you do **not** need full multi-tenant auth. Two sane options:

- **Skip Auth entirely** and keep the app private at the edge (Railway access controls / a single shared password / VPN). All DB access is already server-side with the secret key, so the database is never reachable from a browser.
- **Add a thin login gate** (recommended if the app is internet-facing): enable the **Email provider (magic link)**, **disable public sign-ups**, and manually create your one user. A single middleware check gates the UI. This is ~an afternoon of work and gives you a real login without per-row ownership.

Either way, do **not** build per-user data isolation now — it adds an `owner_id` to every table and policy for zero benefit on a single-operator tool. (If that ever changes, it's an additive migration: add `owner_id`, backfill to your user, add RLS policies. Designing UUID PKs now keeps that door open.)

### 3.3 Supabase Storage — **YES, for all media**

Create private buckets and serve media to the browser via **short-lived signed URLs** generated server-side, replacing today's disk-streaming routes. Recommended buckets:

- `clips` (private) — `{clipId}.mp4` and `{clipId}-edited.mp4`.
- `clip-thumbnails` (can be public-read) — `{clipId}.jpg`.
- `clip-assets` (private) — mirrors `assets/{clipId}/...`.
- `clip-sources` (private) — `{jobId}/source.mp4`. **New**, and it fixes a real bug: the editor currently reads the source from `/tmp`, which fails with "temp file may have been cleared" after a restart. Persisting source to Storage makes the editor durable.

Keep your range-supporting media routes as a thin proxy *or* redirect to the signed URL — redirecting offloads the bandwidth to Supabase's CDN.

### 3.4 Supabase Realtime — **Optional, nice-to-have**

Today, clip-job progress lives in a process-local `Map` and streams over SSE; it's lost on restart and invisible to a second tab. If you persist job progress to the `clip_jobs` row, you can subscribe to row changes with **Realtime** and get a live job grid that survives restarts and works across tabs — without polling. This is a clean upgrade but **not required** for parity; your existing SSE keeps working. Treat it as a Phase-2 enhancement.

### 3.5 Row Level Security (RLS) — **On by default, but minimal policies**

Keep RLS **enabled** on every table (Supabase's default). Because all access is via the secret key (which bypasses RLS) and you expose **no** policies to the publishable/anon key, every table is effectively private and unreachable from the browser — secure by default with zero policy code. If you later add Auth + the login gate, you only need policies if you also expose the publishable key to the client (you currently don't, and shouldn't). Net: leave RLS on, write no policies now.

### 3.6 Edge Functions — **No. Not appropriate here.**

Edge Functions run Deno with strict time/size limits and **cannot run ffmpeg or yt-dlp**, hold a multi-minute detached job, or stream hundreds of MB. Your heavy work must stay on the Railway Node server, which you already have. The only theoretical fits (Meta OAuth callback, a scheduled-publish trigger) are already handled fine by your Next.js routes, so adding Edge Functions would just fragment the codebase. **Recommendation: do not use Edge Functions.**

### 3.6 Why stay on Railway (runtime recommendation)

Moving to Vercel/serverless would break the clipping vertical: no ffmpeg/yt-dlp binaries, ~10–60 s function limits vs. your multi-minute renders, no detached background jobs, and no local disk for range-streaming. Going serverless would force you to split out a separate long-running worker service — a much bigger re-architecture than this migration. **Stay on the Railway container.** Supabase slots in cleanly as the data/storage layer; the container keeps doing compute. (You can later drop the Railway *volume* once media + data live in Supabase, which simplifies deploys.)

---

## 4. Keep your Next.js API routes? — **Yes, keep essentially all of them.**

This is the safest possible shape: the routes' request/response contracts don't change, so the React frontend needs **no changes**. Only the internals of the four storage modules change.

| Route group | Change |
|---|---|
| `configs`, `creators`, `videos`, `outreach/*`, `clip/*` CRUD | **No contract change.** Swap `lib/csv.ts` / `lib/outreach.ts` / `lib/clip/store.ts` internals to Supabase; make callers `await`. |
| `pipeline`, `clip` (SSE runners) | **Keep on the server.** They still run ffmpeg/LLM calls; they just read/write rows via the new data layer. |
| Media routes (`clip/media`, `clip/thumb`, `clip/[jobId]/source`, `clip/asset/*`, `clip/download`) | Change source from disk to **signed Storage URL** (redirect or proxy). |
| `settings` | **Fix a leak** + stop returning secret values; read prefs from DB, read secrets from env. |
| `clip/social/*` (Meta OAuth) | Callback URL unchanged; tokens persisted to DB **encrypted** (or Vault), never returned to client. |

**Do not** replace routes with PostgREST/`supabase-js`-from-the-browser. For an internal tool, server routes + secret key is simpler and keeps secrets off the client.

---

## 5. Database schema design

UUID primary keys throughout (`gen_random_uuid()` from `pgcrypto`). All timestamps `timestamptz`. Document-shaped fields use `jsonb`. Below, each table and *why it exists*.

**`configs`** — pipeline configs. `id uuid pk, config_name text, creators_category text, analysis_instruction text, new_concepts_instruction text, created_at`. *Why:* drives the analysis pipeline; direct map of `configs.csv`.

**`creators`** — competitor IG accounts. `id uuid pk, username text unique, category text, profile_pic_url text, followers int, reels_count_30d int, avg_views_30d int, last_scraped_at timestamptz`. *Why:* the scrape targets; `username` unique enables clean upsert on re-scrape.

**`videos`** — analyzed reels. `id uuid pk, link text, thumbnail text, creator text, views int, likes int, comments int, analysis text, new_concepts text, date_posted text, date_added timestamptz, config_name text, starred boolean`. *Why:* the main output (1,747 rows). Keep `creator`/`config_name` as text initially (the CSV refs are loose) to avoid breakage; add FK columns later if desired. Index `(creator)`, `(starred)`, `(date_added)`.

**`prospect_lists`** — `id uuid pk, name text, created_at`. *Why:* the outreach list container.

**`prospects`** — **the big normalization win.** `id uuid pk, list_id uuid references prospect_lists(id) on delete cascade`, plus every `Prospect` field as typed columns: identity (`company`, `full_name`, `email`, `phone`, `website`, `address`, `location`, …), Maps inputs (`business_category`, `rating numeric`, `review_count int`, `price_range`, `reviews_raw text`), AI outputs (`priority_score int`, `priority_level text`, `review_summary`, `website_status`, `outreach_angle`), messages (`whatsapp_message`, `email_message`, `linkedin_message`, `cold_call_notes jsonb`), CRM (`lead_status`, `last_contacted_at`, `follow_up_date`, `deal_value numeric`, `price_quoted numeric`, `price_confirmed numeric`), plus `source text`, `raw_data jsonb`, `draft_status`, `analysis_status`, timestamps. *Why:* turns the 966 KB whole-file rewrite into a single-row `UPDATE`, and makes the dashboard/filter queries (`lead_status`, `priority_level`) real indexed SQL. Index `(list_id)`, `(lead_status)`, `(priority_level)`, `(analysis_status)`.

**`offer_templates`** — `id uuid pk, offer_name, what_you_sell, channel_focus, value_props jsonb (or text[]), tone, cta, proof_points, dos_and_donts, is_active boolean, created_at`. *Why:* feeds personalization prompts; `is_active` selects the live one.

**`clip_jobs`** — every `ClipJob` field as columns; `errors jsonb/text[]`; **add `progress jsonb` and `status`** so live progress is durable (replaces the in-memory `Map`). *Why:* the clipping pipeline's unit of work; durable progress survives restarts and enables Realtime.

**`clips`** — every `Clip` field; `file_path` becomes the **Storage object key** (not a disk path); keep `public_url` for published clips. Index `(job_id)`, `(starred)`. *Why:* the ranked outputs (currently `clips.csv`).

**`clip_edits`** — `clip_id uuid pk, job_id uuid, doc jsonb, updated_at`. *Why:* the `ClipEdit` is a deeply nested single-source-of-truth document; storing it whole as JSONB preserves the "preview and export are pure functions of one doc" invariant with zero reshaping risk.

**`clip_transcripts`** — `job_id uuid pk, words jsonb, created_at`. *Why:* word-timing arrays the editor needs; JSONB is the natural fit.

**`social_accounts`** — `SocialAccount` fields, but **`access_token` encrypted** (pgcrypto/Vault), never selected to the client. *Why:* publishing targets; tokens are secrets.

**`scheduled_posts`** — direct map of `ScheduledPost`. *Why:* the publish queue/history.

**`caption_templates`** — `id, name, config jsonb, created_at`. **`caption_prompt_templates`** — direct map of `CaptionPromptTemplate`. *Why:* reusable caption style + per-creator caption context.

**`app_settings`** — single-row table (or key/value) for **non-secret** preferences (models, char limits, default presets, editor shortcuts as jsonb). **Secrets do not go here** — see §7.

**`media_objects`** *(optional)* — `id, bucket, object_key, owner_type, owner_id, bytes, content_type, created_at`. *Why:* a lightweight index of Storage objects for cleanup/orphan detection. Nice-to-have, not required.

---

## 6. How the CSV and JSON data gets migrated

A **one-time, idempotent Node script** (run locally against the Supabase secret key), reusing your existing `read*` functions so the source of truth is the live files:

1. **Order (respect FKs):** settings → configs → creators → videos → prospect_lists → prospects → offer_templates → clip_jobs → clips → clip_edits → clip_transcripts → social_accounts → scheduled_posts → caption_templates → caption_prompt_templates.
2. **Transform:** snake_case columns; parse numbers/booleans/dates to real types; nest `Prospect[]` out of each list into `prospects` rows with `list_id`; map `rawData`/`coldCallNotes`/`ClipEdit`/transcript arrays into JSONB.
3. **Upsert by `id`** so re-running is safe (no duplicates). Batch inserts (e.g., 500 rows) — videos and prospects are the only sizeable sets.
4. **Media:** walk `data/clips/` and `data/clips/assets/`; upload each `.mp4`/`.jpg`/asset to its bucket under the **same key**; then update `clips.file_path` to the Storage key. Skip objects that already exist (idempotent). Source videos in `/tmp` are ephemeral — only upload ones still present.
5. **Verify counts** against known totals: 342 configs, 53 creators, 1,747 videos, 29 clips, the prospect count from the lists file, plus a media object count. A short verification script diffs row counts and spot-checks a few records.
6. **Keep the original `data/` files** as the rollback copy until you've run on Supabase for a bake-in period.

---

## 7. Architecture improvements to make *during* the migration

These are low-risk wins to fold in while you're already touching the data layer:

1. **Introduce an async repository layer.** Define interfaces (`VideoRepo`, `ProspectRepo`, `ClipRepo`, …) so routes depend on an interface, not on `fs` or Supabase directly. This is what makes the dual-backend/feature-flag strategy in §8 possible and keeps a clean rollback.
2. **Get secrets out of plaintext.** Today `settings.json` holds live API keys and `social-accounts.json` holds OAuth tokens in the clear, and **`GET /api/settings` returns the keys to the client.** Move secrets to **env vars** (or Supabase Vault), have the settings route return only non-secret prefs + booleans like `hasOpenrouterKey`, and encrypt stored OAuth tokens. **Rotate the keys currently in `.env`/`settings.json`**, since they've been sitting in files.
3. **Normalize prospects** (done in §5) — the biggest performance/correctness win.
4. **Make job state durable.** Persist clip-job progress/cancellation to the `clip_jobs` row instead of the in-memory `Map`, so restarts don't orphan running jobs and any tab can observe progress (pairs with optional Realtime).
5. **Fix editor source durability** by storing source videos in the `clip-sources` bucket (kills the "/tmp cleared" failure).
6. **Add proper types + indexes + `updated_at` triggers** — real numerics/booleans/timestamps and indexes on the columns the dashboards filter by.

---

## 8. Safest migration strategy (so the app keeps working throughout)

Incremental, behind a flag, with files as the rollback net. No big-bang cutover.

- **Phase 0 — Provision (manual).** Complete the §11 checklist: project, keys, env vars, buckets, extensions.
- **Phase 1 — Schema only.** Apply SQL migrations + create buckets. **No app code changes yet**; the live app keeps using files. Zero risk.
- **Phase 2 — Repository layer behind a flag.** Add the async repo interfaces with **two implementations** (`file` and `supabase`) selected by `STORAGE_BACKEND` (default `file`). App still runs on files. Convert call sites to `await`.
- **Phase 3 — Import + verify.** Run the §6 migration script into Supabase. Run the verification/count diff. Files remain the live backend.
- **Phase 4 — Flip in a preview/staging deploy.** Set `STORAGE_BACKEND=supabase` in a Railway preview environment and smoke-test **each vertical**: run an analysis pipeline, import + score a lead list, run a clip job, open the editor + export, connect a social account. Fix parity gaps.
- **Phase 5 — Cut over production.** Flip the flag in prod. **Optionally** run a brief dual-write window (write to both backends) for extra safety. Keep `data/` as the backup.
- **Phase 6 — Decommission.** After a bake-in period with no issues, delete the `fs` implementation and (optionally) drop the Railway volume.

**Rollback at any time:** set `STORAGE_BACKEND=file`. Because files were never deleted, you're instantly back to the known-good state.

---

## 9. What you must create/configure in Supabase before implementation

Assume nothing is set up. Here's everything, by category.

### 9.1 Project settings
- Create a new Supabase project (one project is enough; optionally a second free project for staging).
- **Region:** pick the region closest to your Railway region to minimize DB latency.
- Save the **database password** (shown once at creation) in your password manager.
- Note your **Project Ref** and **Project URL** (`https://<ref>.supabase.co`).

### 9.2 API keys (new key model — note the 2025/2026 change)
Supabase has moved from the legacy `anon`/`service_role` JWT keys to **publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys; new projects use the new model and legacy keys are being retired through late 2026. You need:
- **Publishable key** (`sb_publishable_…`) — safe for any browser use (you'll likely use little/none of it).
- **Secret key** (`sb_secret_…`) — server-side only, used by your API routes and the migration script. Treat like a password; create a separate one for the migration script if you want to revoke it afterward.
- **Database connection string** (pooled, port 6543) — only if you choose Drizzle/Prisma instead of `supabase-js`.

### 9.3 Environment variables (set in Railway and in local `.env`)
```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...            # server-only, never NEXT_PUBLIC_
# DATABASE_URL=postgresql://...:6543/postgres  # only if using an ORM
STORAGE_BACKEND=file                          # migration feature flag; flip to "supabase" at cutover

# Secrets you should MOVE out of settings.json/DB into env (recommended):
OPENROUTER_API_KEY=...
DEEPGRAM_API_KEY=...
ASSEMBLYAI_API_KEY=...
META_APP_ID=...
META_APP_SECRET=...

# Keep your existing ones:
APIFY_API_TOKEN=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
YT_DLP_PATH=...
```
Never prefix the secret key with `NEXT_PUBLIC_`.

### 9.4 Authentication providers
- For the **skip-auth** path: enable nothing.
- For the **thin login gate** (recommended if internet-facing): enable the **Email** provider (magic link), **turn OFF public sign-ups**, and manually create your single user. Optionally add GitHub OAuth for convenience. No other providers needed.

### 9.5 Storage buckets to create
- `clips` — **private**.
- `clip-thumbnails` — public-read is fine (thumbnails), or private if you prefer.
- `clip-assets` — **private**.
- `clip-sources` — **private**.
- Set a per-file size limit (e.g., 200 MB) and restrict MIME types (`video/mp4`, `image/jpeg`, `image/png`).

### 9.6 Database extensions to enable
- **`pgcrypto`** — required (`gen_random_uuid()`, and token encryption if you encrypt OAuth tokens). Usually pre-enabled.
- **`pgvector`** — *optional*, only if you later want semantic search over transcripts/analysis. Not needed for parity.
- **`pg_cron` / `pg_net`** — *not needed* (scheduling stays app-side).

### 9.7 Security settings
- Leave **RLS enabled** on all tables; add **no public policies** (server-only access via secret key).
- Keep all media buckets **private**; serve via short-lived signed URLs from the server.
- **Enforce SSL** on database connections; optionally add **network restrictions** allowing only Railway's egress.
- **Rotate** any API keys/tokens that have been sitting in `.env` / `settings.json` / `social-accounts.json`.
- Don't expose the secret key to the browser; fix `GET /api/settings` so it never returns secret values.

### 9.8 Third-party services & Supabase
- **None are strictly required** to integrate *with* Supabase. Gemini, OpenAI/OpenRouter, Apify, Deepgram/AssemblyAI, and Meta stay as **direct calls from your Railway server** — unchanged.
- **Railway** is the only service that needs Supabase awareness, via the env vars above.
- **Meta**: OAuth callback URL stays on your app domain; only the *token storage* moves into the DB (encrypted).
- **Optional:** Supabase **Vault** for secrets, and Supabase's Storage **CDN** for media delivery.

---

## 10. Open choices for you (small, can decide later)
- **DB client:** `supabase-js` only (simplest) vs. add Drizzle/Prisma for typed SQL. *Recommend:* `supabase-js` only to start.
- **Auth:** skip vs. thin magic-link gate. *Recommend:* thin gate if the app is reachable on the internet; skip if it's behind Railway private networking/VPN.
- **Realtime job progress:** adopt now vs. later. *Recommend:* later (Phase 2 enhancement).

---

## 11. Manual pre-implementation checklist

Complete these **before** any Supabase code is written. When all are checked, we start at Phase 1 (§8).

**Provisioning**
- [ ] Create the Supabase project; record Project Ref, Project URL, and DB password.
- [ ] Choose the region closest to Railway.
- [ ] (Optional) Create a second project for staging.

**Keys & env**
- [ ] Copy the **publishable** key (`sb_publishable_…`).
- [ ] Create/copy a **secret** key (`sb_secret_…`); store it securely.
- [ ] (If using an ORM) copy the pooled **DATABASE_URL**.
- [ ] Add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `STORAGE_BACKEND=file` to Railway **and** local `.env`.
- [ ] Move `OPENROUTER_API_KEY`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `META_APP_ID`, `META_APP_SECRET` into env vars.

**Auth (only if using the login gate)**
- [ ] Enable the Email provider; **disable public sign-ups**.
- [ ] Manually create your single user.

**Storage**
- [ ] Create buckets: `clips` (private), `clip-thumbnails`, `clip-assets` (private), `clip-sources` (private).
- [ ] Set per-file size limit (~200 MB) and allowed MIME types.

**Database**
- [ ] Confirm `pgcrypto` is enabled.
- [ ] (Optional) decide on `pgvector` (future search) — leave off for now.

**Security**
- [ ] Confirm RLS is ON for all tables (it will be by default once tables exist).
- [ ] Enforce SSL; (optional) add network restrictions for Railway egress.
- [ ] **Rotate** the API keys/tokens currently sitting in `.env` / `settings.json` / `social-accounts.json`.

**Safety net**
- [ ] Back up the entire `data/` folder (rows + the 369 MB of media) before importing.

---

*Once this checklist is complete, we begin implementation at Phase 1 (schema + buckets), then build the flagged repository layer, import + verify, and cut over — with `STORAGE_BACKEND=file` as the instant rollback throughout.*
