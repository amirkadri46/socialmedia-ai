# Publishing System — Video Library + Campaigns + Worker

**Date:** 2026-06-26  
**Status:** Ready to implement  
**Supersedes:** The downloader plan (`plans/2026-06-26-bulk-downloader.md`) must be updated — the downloader now saves to R2 instead of local disk. See Phase 3.

---

## What This Builds

A full publishing pipeline on top of the existing app:

1. **Video Library** — every downloaded video is registered in Supabase + stored in Cloudflare R2. Central asset store with deduplication, filters, preview.
2. **Campaigns** — the user creates a campaign, picks videos from the Library, picks Instagram accounts, sets a schedule rule, previews the estimated timeline, then clicks Publish.
3. **Campaign Runner** — a background process that generates upload jobs incrementally (rolling queue) as the campaign progresses.
4. **Publisher Worker** — a separate Railway service that polls every 15 seconds, claims due jobs, uploads the video to R2 (generating a signed URL), calls the Instagram Graph API, waits for processing, publishes, and records history.
5. **Publish History** — immutable audit log of every publishing attempt.

---

## Architecture Summary

```
Downloader (yt-dlp)
  → temp file + SHA-256 hash
  → deduplicate check in Supabase
  → upload to Cloudflare R2 (via StorageProvider abstraction)
  → delete temp file
  → insert storage_objects + videos rows in Supabase
  → Video Library shows it

User creates Campaign in UI
  → selects videos from Library
  → selects Instagram accounts
  → sets schedule rule
  → sees preview: "4,800 jobs over 15 days"
  → clicks Publish → campaign status = running

Campaign Runner (every 5 min, in Worker process)
  → finds running campaigns
  → reads campaign_runner_state cursor
  → generates next batch of upload_jobs (next 50 due within 24h)
  → updates cursor
  → exits

Publisher Worker (every 15 sec, in Worker process)
  → SELECT upload_jobs WHERE status='queued' AND scheduled_at <= now()
  → atomic claim: UPDATE SET status='uploading', claimed_by=worker_id WHERE status='queued'
  → check idempotency_key (already published? skip)
  → generate 6-hour signed URL from R2
  → POST /media to Instagram Graph API (video_url = signed URL)
  → poll container status every 10s until FINISHED
  → POST /media_publish
  → UPDATE upload_jobs SET status='published'
  → INSERT publish_history row
  → on failure: retry up to N times → mark failed

Analytics Worker (every 1 hour, same Worker process)
  → finds publish_history rows where analytics_fetched_at IS NULL
  → calls Instagram Insights API
  → updates views_count, likes_count, comments_count
  → sets analytics_fetched_at
```

---

## Confirmed Decisions

- **Storage:** Cloudflare R2, private bucket, signed URLs (6-hour expiry)
- **Database:** Supabase (Postgres)
- **Worker:** Separate Railway service, same repo, start command: `npx tsx worker/index.ts`
- **Downloader output:** R2 (not local disk) — update the downloader plan
- **Deduplication:** SHA-256 checksum on every downloaded file
- **Captions:** Generated once per video, stored in `video_captions` table, reused across all accounts
- **Job generation:** Rolling queue — Campaign Runner generates next batch, not all upfront
- **Account reuse:** Migrate existing `/clip/social` accounts to Supabase `instagram_accounts`
- **Assignment mode:** Cross-post (same video → all accounts)
- **History:** Immutable append-only, never update rows
- **Analytics:** Separate interval in worker, publishing never waits on it
- **Daily limit check:** `SELECT COUNT(*) FROM publish_history WHERE account_id=? AND published_at >= today`
- **Campaign preview:** Show before Publish click — total jobs, duration, first/last post date

---

## Environment Variables

Add to both Railway services (Next.js app + Worker):

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Cloudflare R2
R2_ACCOUNT_ID=abc123
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your-bucket-name
R2_ENDPOINT=https://abc123.r2.cloudflarestorage.com

# Worker identity (for job claiming)
WORKER_ID=worker-1
```

---

## Supabase Schema (Run in order)

```sql
-- 1. Storage objects (one row per physical file in R2)
CREATE TABLE storage_objects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'r2',
  bucket        text NOT NULL,
  key           text NOT NULL,           -- e.g. "videos/abc123.mp4"
  mime_type     text,
  size_bytes    bigint,
  checksum      text,                    -- SHA-256 hex, used for deduplication
  version       int NOT NULL DEFAULT 1,
  is_current    boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX ON storage_objects(checksum);
CREATE INDEX ON storage_objects(key, is_current);

-- 2. Instagram accounts (migrated from /clip/social JSON)
CREATE TABLE instagram_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_user_id        text UNIQUE NOT NULL,   -- Instagram user ID from Graph API
  username          text NOT NULL,
  display_name      text,
  access_token      text NOT NULL,
  token_expires_at  timestamptz,
  status            text NOT NULL DEFAULT 'connected',
                    -- connected | needs_reauth | disconnected
  last_posted_at    timestamptz,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX ON instagram_accounts(status);

-- 3. Videos (one row per downloaded video)
CREATE TABLE videos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_object_id     uuid REFERENCES storage_objects(id),
  thumbnail_object_id   uuid REFERENCES storage_objects(id),
  title                 text NOT NULL,
  creator               text,
  platform              text,             -- youtube | instagram | unknown
  duration_sec          int,
  original_url          text,             -- source URL for re-download if needed
  storage_status        text NOT NULL DEFAULT 'available',
                        -- available | deleted
  publish_status        text NOT NULL DEFAULT 'unpublished',
                        -- unpublished | scheduled | published
  downloaded_at         timestamptz DEFAULT now()
);
CREATE INDEX ON videos(platform);
CREATE INDEX ON videos(storage_status, publish_status);

-- 4. Per-platform captions (one row per video per platform)
CREATE TABLE video_captions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id    uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  platform    text NOT NULL DEFAULT 'instagram',
  language    text NOT NULL DEFAULT 'en',
  caption     text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(video_id, platform, language)
);

-- 5. Campaigns
CREATE TABLE campaigns (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft',
                          -- draft | ready | scheduled | running | paused | completed | cancelled
  caption_prompt_template text,          -- AI prompt template for caption generation
  assignment_mode         text NOT NULL DEFAULT 'crosspost',
                          -- crosspost | distribute
  schedule_rule           jsonb NOT NULL,
  -- schedule_rule shape:
  -- {
  --   frequencyHours: number,        -- e.g. 3
  --   windowStart: "09:00",          -- local time
  --   windowEnd: "22:00",
  --   timezone: "Asia/Kolkata",
  --   randomizeMinutes: 10,          -- ±10 min jitter
  --   startDate: "2026-07-01"
  -- }
  timezone                text NOT NULL DEFAULT 'Asia/Kolkata',
  starts_at               timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- 6. Campaign → Videos (ordered join table)
CREATE TABLE campaign_videos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  video_id     uuid NOT NULL REFERENCES videos(id),
  position     int NOT NULL,              -- ordering within campaign
  skipped      boolean NOT NULL DEFAULT false,
  UNIQUE(campaign_id, video_id)
);
CREATE INDEX ON campaign_videos(campaign_id, position);

-- 7. Campaign → Accounts
CREATE TABLE campaign_accounts (
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES instagram_accounts(id),
  PRIMARY KEY(campaign_id, account_id)
);

-- 8. Campaign runner state (separate from campaign metadata)
CREATE TABLE campaign_runner_state (
  campaign_id   uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  cursor        int NOT NULL DEFAULT 0,  -- last_scheduled_position in campaign_videos
  last_tick     timestamptz,
  locked_until  timestamptz,
  worker_id     text
);

-- 9. Upload jobs (generated incrementally by Campaign Runner)
CREATE TABLE upload_jobs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id             uuid REFERENCES campaigns(id),
  video_id                uuid NOT NULL REFERENCES videos(id),
  account_id              uuid NOT NULL REFERENCES instagram_accounts(id),
  scheduled_at            timestamptz NOT NULL,
  idempotency_key         text UNIQUE NOT NULL,  -- uuid, prevents double-publish
  status                  text NOT NULL DEFAULT 'queued',
                          -- queued | preparing | uploading | waiting_for_instagram
                          -- | publishing | published | failed | cancelled
  retry_count             int NOT NULL DEFAULT 0,
  error_message           text,
  claimed_by              text,           -- worker_id that claimed this job
  claimed_at              timestamptz,
  instagram_container_id  text,
  instagram_media_id      text,
  published_at            timestamptz,
  created_at              timestamptz DEFAULT now()
);
CREATE INDEX ON upload_jobs(status, scheduled_at);
CREATE INDEX ON upload_jobs(campaign_id);
CREATE INDEX ON upload_jobs(account_id, scheduled_at);

-- 10. Publish history (immutable audit log, append-only, never update)
CREATE TABLE publish_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id               uuid REFERENCES upload_jobs(id),
  video_id             uuid NOT NULL REFERENCES videos(id),
  account_id           uuid NOT NULL REFERENCES instagram_accounts(id),
  instagram_media_id   text,
  permalink            text,
  published_at         timestamptz NOT NULL DEFAULT now(),
  -- Analytics (populated later by Analytics Worker, all nullable)
  views_count          bigint,
  likes_count          bigint,
  comments_count       bigint,
  reach                bigint,
  analytics_fetched_at timestamptz
);
CREATE INDEX ON publish_history(account_id, published_at);
CREATE INDEX ON publish_history(analytics_fetched_at) WHERE analytics_fetched_at IS NULL;
```

---

## File Structure

```
app/src/lib/
  supabase.ts                     ← Supabase client (server-side, service role)
  storage/
    types.ts                      ← StorageProvider interface
    r2.ts                         ← R2 implementation using @aws-sdk/client-s3
    index.ts                      ← factory: getStorageProvider()
  publishing/
    types.ts                      ← shared TypeScript types (mirrors Supabase schema)
    instagram-publisher.ts        ← Instagram Graph API: create container, poll, publish
    campaign-runner.ts            ← generates next batch of upload_jobs for a campaign
    token-refresh.ts              ← refresh IG tokens expiring within 7 days
    daily-limit.ts                ← check daily post count for an account

app/src/app/
  api/
    library/
      route.ts                    ← GET (list videos with filters), DELETE
      [id]/route.ts               ← GET single video, PATCH (status), DELETE
      [id]/caption/route.ts       ← GET/POST/PUT caption for video+platform
    campaigns/
      route.ts                    ← GET list, POST create
      [id]/route.ts               ← GET, PATCH, DELETE
      [id]/preview/route.ts       ← GET schedule preview (jobs, duration, first/last)
      [id]/publish/route.ts       ← POST → set status=running, seed runner_state
      [id]/pause/route.ts         ← POST → set status=paused
      [id]/videos/route.ts        ← GET/POST/DELETE campaign_videos
      [id]/accounts/route.ts      ← GET/POST/DELETE campaign_accounts
    upload-jobs/
      route.ts                    ← GET (filterable by campaign, status, account)
      [id]/route.ts               ← GET single job, PATCH (cancel)
    publish-history/
      route.ts                    ← GET (filterable)
    accounts/
      route.ts                    ← GET all accounts (from Supabase)
      [id]/route.ts               ← GET, PATCH, DELETE

  library/
    page.tsx                      ← Video Library page
  campaigns/
    page.tsx                      ← Campaign list page
    new/page.tsx                  ← Create campaign page
    [id]/page.tsx                 ← Campaign detail / manage page

app/src/components/
  library/
    video-grid.tsx                ← Masonry/grid of VideoCard components
    video-card.tsx                ← Thumbnail, title, creator, platform, status badges
    filter-bar.tsx                ← Platform / status / creator / duration / search filters
    video-preview-modal.tsx       ← Full preview with video player + metadata + caption
  campaigns/
    campaign-list.tsx             ← List of campaigns with status chips
    campaign-form.tsx             ← Create/edit campaign (name, schedule rule, prompt)
    schedule-rule-editor.tsx      ← Frequency, window, timezone, jitter UI
    video-selector.tsx            ← Picks videos from Library for a campaign (searchable)
    account-selector.tsx          ← Picks Instagram accounts for a campaign
    campaign-preview-card.tsx     ← Shows "4,800 jobs, 15 days, first: July 1 9AM"
    job-table.tsx                 ← upload_jobs table with status, progress, retry
    status-badge.tsx              ← Colored badge for job/campaign lifecycle states

worker/
  index.ts                        ← Entry point: starts all intervals
  publisher.ts                    ← Publisher Worker logic (15s tick)
  campaign-runner.ts              ← Campaign Runner logic (5min tick)
  analytics.ts                    ← Analytics Worker logic (1hr tick)
  token-refresh.ts                ← Token refresh (1hr tick)
  supabase.ts                     ← Supabase client for worker (service role)
  storage.ts                      ← Storage provider for worker (R2)
  instagram.ts                    ← Instagram Graph API calls (shared with app)

Modified files:
  app/src/components/app-sidebar.tsx    ← Add Library + Campaigns sections
  app/src/lib/downloader/queue-runner.ts ← After download: upload to R2, write Supabase
  app/src/app/clip/social/page.tsx      ← Read accounts from Supabase instead of JSON
```

---

## Phase 1 — Supabase Client + Account Migration

### `app/src/lib/supabase.ts`

```typescript
import { createClient } from "@supabase/supabase-js";

// Server-side client using service role key (full access, never expose to browser)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Public client (anon key, safe to use in browser)
export const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

Install: `npm install @supabase/supabase-js` inside `app/`.

### Account Migration

Create a migration script `scripts/migrate-accounts.ts` that:
1. Reads existing Instagram accounts from wherever `/clip/social` stores them (check `lib/clip/store.ts` for the accounts store — it reads from `data/social-accounts.json` or similar)
2. For each account, inserts a row into Supabase `instagram_accounts`
3. Logs results

Update `/clip/social` page and all related API routes to read/write from Supabase instead of the JSON file. The `ig_user_id` is the unique key — use upsert to avoid duplicates on re-run.

---

## Phase 2 — Storage Abstraction Layer

### `app/src/lib/storage/types.ts`

```typescript
export interface StorageProvider {
  /** Upload a file buffer. key = "videos/abc123.mp4" */
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  
  /** Generate a pre-signed URL valid for expiresInSeconds (default 21600 = 6h) */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  
  /** Hard-delete a file */
  delete(key: string): Promise<void>;
  
  /** Check if a key exists */
  exists(key: string): Promise<boolean>;
}
```

### `app/src/lib/storage/r2.ts`

Implements `StorageProvider` using `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.

Install: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` inside `app/`.

```typescript
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider } from "./types";

export function createR2Provider(): StorageProvider {
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.R2_BUCKET_NAME!;

  return {
    async upload(key, buffer, mimeType) {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType,
      }));
    },

    async getSignedUrl(key, expiresInSeconds = 21600) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch { return false; }
    },
  };
}
```

### `app/src/lib/storage/index.ts`

```typescript
import { createR2Provider } from "./r2";
import type { StorageProvider } from "./types";

let _provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!_provider) _provider = createR2Provider();
  return _provider;
}
```

---

## Phase 3 — Downloader Update (feeds Video Library)

**This updates the downloader plan.** The queue runner in `lib/downloader/queue-runner.ts` currently saves videos to local disk. Change it to upload to R2 and register in Supabase.

### After yt-dlp finishes downloading a job, the runner calls `ingestVideo()`:

Create `app/src/lib/downloader/ingest.ts`:

```typescript
import { createHash } from "crypto";
import { readFileSync, unlinkSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { getStorageProvider } from "@/lib/storage";
import { supabase } from "@/lib/supabase";

export async function ingestVideo(
  tempVideoPath: string,
  tempThumbPath: string | null,
  meta: { title: string; creator: string; platform: string; durationSec: number; originalUrl: string }
): Promise<string> {
  // 1. Read file + compute SHA-256 checksum
  const videoBuffer = readFileSync(tempVideoPath);
  const checksum = createHash("sha256").update(videoBuffer).digest("hex");

  // 2. Deduplication check
  const { data: existing } = await supabase
    .from("storage_objects")
    .select("id, videos(id)")
    .eq("checksum", checksum)
    .eq("is_current", true)
    .single();

  if (existing) {
    // Already in library — clean up temp files and return existing video id
    unlinkSync(tempVideoPath);
    if (tempThumbPath) try { unlinkSync(tempThumbPath); } catch {}
    return (existing as any).videos[0]?.id ?? existing.id;
  }

  const storage = getStorageProvider();
  const videoId = uuid();

  // 3. Upload video to R2
  const videoKey = `videos/${videoId}.mp4`;
  await storage.upload(videoKey, videoBuffer, "video/mp4");
  unlinkSync(tempVideoPath); // delete temp immediately after upload

  // 4. Upload thumbnail if available
  let thumbObjectId: string | null = null;
  if (tempThumbPath) {
    try {
      const thumbBuffer = readFileSync(tempThumbPath);
      const thumbKey = `thumbnails/${videoId}.jpg`;
      await storage.upload(thumbKey, thumbBuffer, "image/jpeg");
      unlinkSync(tempThumbPath);

      const { data: thumbObj } = await supabase
        .from("storage_objects")
        .insert({
          provider: "r2",
          bucket: process.env.R2_BUCKET_NAME,
          key: thumbKey,
          mime_type: "image/jpeg",
          size_bytes: thumbBuffer.length,
        })
        .select("id")
        .single();
      thumbObjectId = thumbObj?.id ?? null;
    } catch { /* thumbnail is optional */ }
  }

  // 5. Insert storage_object for video
  const { data: storageObj } = await supabase
    .from("storage_objects")
    .insert({
      provider: "r2",
      bucket: process.env.R2_BUCKET_NAME,
      key: videoKey,
      mime_type: "video/mp4",
      size_bytes: videoBuffer.length,
      checksum,
    })
    .select("id")
    .single();

  // 6. Insert video row
  const { data: video } = await supabase
    .from("videos")
    .insert({
      id: videoId,
      storage_object_id: storageObj!.id,
      thumbnail_object_id: thumbObjectId,
      title: meta.title,
      creator: meta.creator,
      platform: meta.platform,
      duration_sec: meta.durationSec,
      original_url: meta.originalUrl,
    })
    .select("id")
    .single();

  return video!.id;
}
```

**Update `lib/downloader/engine.ts`:** After `downloadSingleJob()` completes (yt-dlp finishes), call `ingestVideo()` with the temp paths. The download output template should use a temp dir (use `os.tmpdir()` + a unique job id subfolder) instead of the final `D:\downloaded videos` path. yt-dlp saves to temp, `ingestVideo` uploads to R2, deletes temp.

**Update `DownloadJob` type:** Remove `outputPath` (no longer meaningful). Add `videoLibraryId: string` (Supabase video ID after ingestion).

**Update DownloaderSettings:** Remove `downloadDir`, `overwriteExisting` (R2 handles dedup via checksum). Keep `quality`, `concurrentDownloads`, `retryCount`, `skipDuplicates` (still relevant — skip if checksum exists).

---

## Phase 4 — Video Library UI

### API: `app/src/app/api/library/route.ts`

**GET** — list videos with filters:

Query params: `platform`, `storage_status`, `publish_status`, `creator`, `search` (title contains), `limit` (default 50), `offset`.

Join with `storage_objects` to get the key for thumbnail signed URL generation. For each video, call `storage.getSignedUrl(thumbnail_object.key, 3600)` to get a 1-hour signed URL for display.

Return shape per video:
```typescript
{
  id, title, creator, platform, duration_sec, publish_status, storage_status,
  downloaded_at, thumbnail_url  // signed URL, 1-hour expiry
}
```

**Note:** Don't pre-sign the main video URL on list — only on the preview modal request (on-demand).

### API: `app/src/app/api/library/[id]/route.ts`

**GET** — single video with full metadata + signed video URL (6h) + signed thumb URL (1h) + captions.

### Page: `app/src/app/library/page.tsx`

Client component. Fetches from `/api/library` with 30s polling (or on-demand refresh).

Layout:
```
Header: "Video Library"  [+ Import Videos button → links to /downloader]

FilterBar (sticky):
  [All Platforms ▼] [All Statuses ▼] [Search by title...] [Creator ▼] [Sort ▼]

Stats row: "423 videos  |  312 available  |  89 scheduled  |  22 published"

VideoGrid: responsive grid (3-5 columns), each VideoCard shows:
  - Thumbnail (signed URL from API)
  - Platform badge (YT / IG)
  - Duration chip
  - Status badge (Available / Scheduled / Published)
  - Creator name
  - Title (truncated)
  - On hover: [Preview] [Add to Campaign] buttons

Empty state: Download icon + "No videos yet. Go to Downloads to get started." + [Go to Downloads] button
```

### Component: `video-card.tsx`

On click → opens `VideoPreviewModal`.

### Component: `video-preview-modal.tsx`

Shows:
- Video player (`<video>` tag with `src` = signed URL fetched on open)
- Title, creator, platform, duration, downloaded date
- Caption section: shows current Instagram caption if exists, [Generate Caption] button that calls `/api/library/[id]/caption` with POST (triggers AI generation using existing `lib/llm-client.ts` or similar)
- [Add to Campaign] button
- [Delete from Library] button (sets storage_status = 'deleted', marks R2 object deleted_at)

### Caption generation API: `app/src/app/api/library/[id]/caption/route.ts`

**POST** — generate caption for a video using the campaign's `caption_prompt_template` (or a default template if not yet in a campaign).

Build the prompt from video metadata (title, creator, platform, duration). Call the configured LLM (via `lib/llm-client.ts`). Insert/upsert into `video_captions` table with `platform='instagram'`.

**GET** — return existing caption(s) for this video.

---

## Phase 5 — Campaigns UI

### Sidebar Updates (`components/app-sidebar.tsx`)

Import `Library` and `Megaphone` icons from lucide-react.

Add two new sections **before** the existing "Downloader" section:

```typescript
{
  id: "library",
  icon: Library,
  label: "Library",
  items: [
    { title: "Video Library", href: "/library", icon: Library },
  ],
},
{
  id: "campaigns",
  icon: Megaphone,
  label: "Campaigns",
  items: [
    { title: "Campaigns", href: "/campaigns", icon: Megaphone },
    { title: "Queue", href: "/campaigns/queue", icon: ListChecks },
    { title: "History", href: "/campaigns/history", icon: History },
  ],
},
```

Update `getSectionFromPath`:
```typescript
if (pathname.startsWith("/library")) return "library";
if (pathname.startsWith("/campaigns")) return "campaigns";
```

### Campaign List Page: `app/src/app/campaigns/page.tsx`

Shows all campaigns. Each row:
- Campaign name
- Status badge (Draft / Ready / Running / Paused / Completed)
- Videos count, accounts count
- "X jobs pending / Y published"
- Start date
- [Manage] → `/campaigns/[id]`
- [Pause] / [Resume] buttons (if running/paused)

[+ New Campaign] button → `/campaigns/new`

### Create Campaign Page: `app/src/app/campaigns/new/page.tsx`

Multi-step form (use shadcn `Tabs` or step indicator):

**Step 1 — Details:**
- Campaign name (Input)
- Caption prompt template (Textarea) — default: `"Write an engaging Instagram caption for this video by {creator} about {title}. Include relevant hashtags. Keep it authentic and engaging."`

**Step 2 — Select Videos:**
- `VideoSelector` component: shows Video Library in a grid with checkboxes
- Filters work inline (platform, creator, search)
- Shows count: "X videos selected"
- [Select All Filtered] button
- Drag-to-reorder selected videos (use HTML5 drag-and-drop or a simple up/down button)

**Step 3 — Select Accounts:**
- `AccountSelector`: shows all connected Instagram accounts from Supabase
- Checkboxes
- Shows account username + status (connected = green, needs_reauth = red)

**Step 4 — Schedule Rule:**
- `ScheduleRuleEditor` component:
  - Start date (DatePicker)
  - Start time (Select: 6AM, 7AM, 8AM, ..., 11PM)
  - Timezone (Select: popular timezones + search)
  - Posting frequency (Select: Every 1h / 2h / 3h / 4h / 6h / 8h / 12h / 24h)
  - Publishing window (Start time → End time: e.g., 9AM to 10PM — no posts outside window)
  - Randomize ±minutes (Select: None / ±5min / ±10min / ±15min / ±30min)

**Step 5 — Preview & Publish:**
- `CampaignPreviewCard` — calls `GET /api/campaigns/[id]/preview`:
  ```
  Campaign: "July Fitness Content"
  Videos selected: 120
  Accounts: 40
  Total jobs: 4,800
  Posting frequency: Every 3 hours
  Window: 9:00 AM – 10:00 PM (Asia/Kolkata)
  Estimated duration: 15 days
  First post: Monday July 1, 2026 at 9:00 AM
  Last post: Tuesday July 16, 2026 at 6:00 PM
  ```
- [Save as Draft] button — saves campaign with `status='draft'`
- [Publish Campaign] button — calls `POST /api/campaigns/[id]/publish`:
  - Sets campaign `status='running'`
  - Inserts row into `campaign_runner_state` with `cursor=0`
  - Campaign Runner will generate first batch of jobs on next tick

### Campaign Preview API: `app/src/app/api/campaigns/[id]/preview/route.ts`

**GET** — calculate without creating jobs:

```typescript
function calculatePreview(
  videoCount: number,
  accountCount: number,
  scheduleRule: ScheduleRule
): CampaignPreview {
  const totalJobs = videoCount * accountCount;
  const postsPerDay = Math.floor((windowHours) / frequencyHours);
  const totalDays = Math.ceil(totalJobs / (postsPerDay * accountCount));
  
  // Walk the schedule rule to find first and last slot
  const firstPost = computeFirstSlot(scheduleRule);
  const lastPost = computeNthSlot(firstPost, totalJobs, scheduleRule);
  
  return { totalJobs, estimatedDurationDays: totalDays, firstPost, lastPost };
}
```

The `computeNthSlot` function respects the publishing window (no posts outside 9AM-10PM) and the frequency. It's a pure function — no database reads needed.

---

## Phase 6 — Campaign Runner + Publisher Worker

### Worker Entry Point: `worker/index.ts`

**This is a plain Node.js/TypeScript file. It does NOT use Next.js.**

```typescript
import { runPublisherTick } from "./publisher";
import { runCampaignRunnerTick } from "./campaign-runner";
import { runAnalyticsTick } from "./analytics";
import { runTokenRefreshTick } from "./token-refresh";

console.log(`[Worker] Starting. WORKER_ID=${process.env.WORKER_ID}`);

// Publisher: every 15 seconds
setInterval(runPublisherTick, 15_000);
runPublisherTick();

// Campaign Runner: every 5 minutes
setInterval(runCampaignRunnerTick, 5 * 60_000);
runCampaignRunnerTick();

// Analytics: every 1 hour
setInterval(runAnalyticsTick, 60 * 60_000);

// Token refresh: every 1 hour
setInterval(runTokenRefreshTick, 60 * 60_000);
runTokenRefreshTick();

console.log("[Worker] All intervals started.");
```

**Railway config for worker service:**
- Repository: same repo
- Root directory: `app` (same as main service)
- Start command: `npx tsx ../worker/index.ts`
- Environment: same env vars as main service

**Import paths from worker:** Worker files import Supabase and R2 via their own local wrappers (`worker/supabase.ts`, `worker/storage.ts`) that instantiate the same clients. This avoids pulling in Next.js internals.

`worker/supabase.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

`worker/storage.ts`:
```typescript
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function getSignedVideoUrl(key: string, expiresInSeconds = 21600) {
  const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
```

### Campaign Runner: `worker/campaign-runner.ts`

```typescript
export async function runCampaignRunnerTick() {
  // 1. Find running campaigns not currently locked
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id")
    .eq("status", "running");

  for (const campaign of campaigns ?? []) {
    await processCampaign(campaign.id);
  }
}

async function processCampaign(campaignId: string) {
  // 2. Acquire lock on campaign_runner_state
  const workerId = process.env.WORKER_ID!;
  const now = new Date();
  
  // Upsert runner state, only proceed if we can claim the lock
  const { data: state, error } = await supabase
    .from("campaign_runner_state")
    .upsert({
      campaign_id: campaignId,
      locked_until: new Date(now.getTime() + 60_000).toISOString(), // lock for 60s
      worker_id: workerId,
      last_tick: now.toISOString(),
    }, {
      onConflict: "campaign_id",
      ignoreDuplicates: false,
    })
    .select("cursor")
    .single();
  
  // If another worker holds the lock, skip
  // (In production: check locked_until > now and worker_id != ours first)
  if (error) return;
  
  const cursor = state?.cursor ?? 0;

  // 3. Read campaign settings
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*, campaign_videos(video_id, position, skipped), campaign_accounts(account_id)")
    .eq("id", campaignId)
    .single();
  
  if (!campaign) return;

  // 4. Get next batch of unscheduled videos (position > cursor, not skipped)
  const unscheduled = campaign.campaign_videos
    .filter((cv: any) => cv.position > cursor && !cv.skipped)
    .sort((a: any, b: any) => a.position - b.position)
    .slice(0, 50); // generate up to 50 next videos at a time

  if (unscheduled.length === 0) {
    // All videos scheduled → mark campaign completed
    await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaignId);
    return;
  }

  const accounts = campaign.campaign_accounts.map((ca: any) => ca.account_id);
  const scheduleRule = campaign.schedule_rule;

  // 5. Generate upload_jobs for each video × account
  const jobs = [];
  let slotTime = computeNextSlot(scheduleRule, new Date()); // compute from now or last scheduled time
  
  for (const cv of unscheduled) {
    for (const accountId of accounts) {
      // Apply jitter
      const jitterMs = (Math.random() * 2 - 1) * (scheduleRule.randomizeMinutes ?? 0) * 60_000;
      const scheduledAt = new Date(slotTime.getTime() + jitterMs);
      
      jobs.push({
        campaign_id: campaignId,
        video_id: cv.video_id,
        account_id: accountId,
        scheduled_at: scheduledAt.toISOString(),
        idempotency_key: `${campaignId}-${cv.video_id}-${accountId}`, // deterministic key
        status: "queued",
      });
    }
    slotTime = computeNextSlot(scheduleRule, slotTime); // advance to next slot
  }

  // 6. Bulk insert jobs
  await supabase.from("upload_jobs").insert(jobs);

  // 7. Update cursor
  const newCursor = unscheduled[unscheduled.length - 1].position;
  await supabase
    .from("campaign_runner_state")
    .update({ cursor: newCursor, locked_until: null })
    .eq("campaign_id", campaignId);
}

/** Advance a datetime to the next valid posting slot per schedule rule */
function computeNextSlot(rule: ScheduleRule, from: Date): Date {
  // Respect windowStart, windowEnd, frequencyHours, timezone
  // If from + frequencyHours is outside window → jump to next day windowStart
  // Implementation uses date-fns-tz for timezone-aware arithmetic
}
```

Install: `npm install date-fns date-fns-tz` in `app/`.

### Publisher Worker: `worker/publisher.ts`

```typescript
export async function runPublisherTick() {
  const workerId = process.env.WORKER_ID!;
  const now = new Date().toISOString();

  // 1. Find due jobs (not already claimed)
  const { data: jobs } = await supabase
    .from("upload_jobs")
    .select(`
      id, video_id, account_id, idempotency_key, retry_count,
      instagram_container_id,
      videos(storage_object_id, storage_objects(key)),
      instagram_accounts(ig_user_id, access_token, username),
      video_captions(caption)
    `)
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .is("claimed_by", null)
    .limit(5); // process max 5 concurrent jobs per tick

  for (const job of jobs ?? []) {
    processJob(job, workerId).catch((err) =>
      console.error(`[Publisher] Job ${job.id} error:`, err)
    );
  }
}

async function processJob(job: any, workerId: string) {
  // 2. Atomic claim — prevents two workers from processing same job
  const { count } = await supabase
    .from("upload_jobs")
    .update({ status: "preparing", claimed_by: workerId, claimed_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued") // only update if still queued
    .select("id", { count: "exact" });

  if (count === 0) return; // another worker claimed it

  // 3. Idempotency check — did we already publish this?
  const { data: history } = await supabase
    .from("publish_history")
    .select("id")
    .eq("job_id", job.id)
    .limit(1);

  if (history && history.length > 0) {
    // Already published — mark job published and exit
    await supabase.from("upload_jobs").update({ status: "published" }).eq("id", job.id);
    return;
  }

  // 4. Check daily post limit for this account
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: dailyCount } = await supabase
    .from("publish_history")
    .select("id", { count: "exact" })
    .eq("account_id", job.account_id)
    .gte("published_at", today.toISOString());

  if ((dailyCount ?? 0) >= 50) {
    // Daily limit reached — reschedule to tomorrow
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60_000);
    await supabase.from("upload_jobs").update({
      status: "queued",
      scheduled_at: tomorrow.toISOString(),
      claimed_by: null,
      claimed_at: null,
    }).eq("id", job.id);
    return;
  }

  try {
    // 5. Generate 6-hour signed URL for the video
    const storageKey = job.videos?.storage_objects?.key;
    if (!storageKey) throw new Error("No storage key for video");

    const signedUrl = await getSignedVideoUrl(storageKey, 21600);

    // 6. Get caption
    const caption = job.video_captions?.[0]?.caption ?? "";
    const account = job.instagram_accounts;

    await supabase.from("upload_jobs").update({ status: "uploading" }).eq("id", job.id);

    // 7. Create Instagram media container
    const containerId = await createInstagramContainer(
      account.ig_user_id,
      account.access_token,
      signedUrl,
      caption
    );

    await supabase.from("upload_jobs")
      .update({ status: "waiting_for_instagram", instagram_container_id: containerId })
      .eq("id", job.id);

    // 8. Poll until Instagram finishes processing
    const containerStatus = await pollContainerStatus(account.access_token, containerId);
    if (containerStatus !== "FINISHED") throw new Error(`Container status: ${containerStatus}`);

    await supabase.from("upload_jobs").update({ status: "publishing" }).eq("id", job.id);

    // 9. Publish
    const mediaId = await publishContainer(account.ig_user_id, account.access_token, containerId);

    // 10. Update job
    await supabase.from("upload_jobs").update({
      status: "published",
      instagram_media_id: mediaId,
      published_at: new Date().toISOString(),
    }).eq("id", job.id);

    // 11. Insert immutable history row
    await supabase.from("publish_history").insert({
      job_id: job.id,
      video_id: job.video_id,
      account_id: job.account_id,
      instagram_media_id: mediaId,
      published_at: new Date().toISOString(),
    });

    // 12. Update video publish_status
    await supabase.from("videos").update({ publish_status: "published" }).eq("id", job.video_id);

    console.log(`[Publisher] Published job ${job.id} → media ${mediaId}`);

  } catch (err) {
    const maxRetries = 3;
    const newRetryCount = (job.retry_count ?? 0) + 1;

    if (newRetryCount >= maxRetries) {
      await supabase.from("upload_jobs").update({
        status: "failed",
        error_message: String(err),
        retry_count: newRetryCount,
      }).eq("id", job.id);
    } else {
      // Retry in 15 minutes
      const retryAt = new Date(Date.now() + 15 * 60_000).toISOString();
      await supabase.from("upload_jobs").update({
        status: "queued",
        error_message: String(err),
        retry_count: newRetryCount,
        claimed_by: null,
        claimed_at: null,
        scheduled_at: retryAt,
      }).eq("id", job.id);
    }
  }
}
```

### Instagram Graph API calls: `worker/instagram.ts`

```typescript
const GRAPH_BASE = "https://graph.instagram.com/v21.0";

/** Create a Reel container. Returns container ID. */
export async function createInstagramContainer(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  caption: string
): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: accessToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(`Container creation failed: ${JSON.stringify(data)}`);
  return data.id;
}

/** Poll until container status is FINISHED or ERROR. Timeout after 10 minutes. */
export async function pollContainerStatus(
  accessToken: string,
  containerId: string
): Promise<string> {
  const maxAttempts = 60; // 60 × 10s = 10 minutes
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(10_000);
    const res = await fetch(
      `${GRAPH_BASE}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const data = await res.json();
    if (data.status_code === "FINISHED") return "FINISHED";
    if (data.status_code === "ERROR") throw new Error(`Instagram container error: ${JSON.stringify(data)}`);
    // IN_PROGRESS or PUBLISHED → keep polling
  }
  throw new Error("Container processing timed out after 10 minutes");
}

/** Publish a ready container. Returns Instagram media ID. */
export async function publishContainer(
  igUserId: string,
  accessToken: string,
  containerId: string
): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(`Publish failed: ${JSON.stringify(data)}`);
  return data.id;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

### Token Refresh: `worker/token-refresh.ts`

```typescript
export async function runTokenRefreshTick() {
  // Find accounts whose token expires within 7 days
  const threshold = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
  
  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("id, access_token")
    .eq("status", "connected")
    .lt("token_expires_at", threshold);

  for (const account of accounts ?? []) {
    try {
      const res = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${account.access_token}`
      );
      const data = await res.json();
      if (data.access_token) {
        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
        await supabase.from("instagram_accounts").update({
          access_token: data.access_token,
          token_expires_at: expiresAt,
        }).eq("id", account.id);
        console.log(`[TokenRefresh] Refreshed token for account ${account.id}`);
      }
    } catch (err) {
      // Mark as needs_reauth
      await supabase.from("instagram_accounts")
        .update({ status: "needs_reauth" })
        .eq("id", account.id);
    }
  }
}
```

---

## Phase 7 — Queue Page + Publish History

### Queue Page: `app/src/app/campaigns/queue/page.tsx`

Client component. Polls `GET /api/upload-jobs?status=queued,uploading,waiting_for_instagram,publishing,failed` every 15 seconds.

Shows a table with columns: Thumbnail | Video Title | Account | Scheduled At | Status | Retry | Actions.

- Status badges use the full lifecycle: `queued` (grey), `preparing` (blue), `uploading` (blue spinner), `waiting_for_instagram` (orange), `publishing` (blue), `published` (green), `failed` (red), `cancelled` (grey strikethrough).
- [Cancel] action on queued jobs.
- [Retry] action on failed jobs (resets to queued, clears error).

Group by campaign at the top. Show campaign-level stats: "Campaign: July Fitness — 320/4800 published".

### History Page: `app/src/app/campaigns/history/page.tsx`

Client component. Polls `GET /api/publish-history` every 60 seconds.

Filterable by account, date range, platform.

Columns: Thumbnail | Video | Account | Published At | Instagram URL (permalink) | Views | Likes | Comments (nullable — "—" until analytics fetched).

---

## Phase 8 — Analytics Worker (implement last)

### `worker/analytics.ts`

Every hour, find `publish_history` rows where `analytics_fetched_at IS NULL` and `published_at < 1 hour ago` (give time for Instagram to have data).

For each, call the Instagram Insights API:
```
GET /v21.0/{media_id}/insights?metric=impressions,reach,likes,comments&access_token={token}
```

Update the row with fetched metrics. Set `analytics_fetched_at = now()`.

**Never block publishing on analytics.** This runs completely independently.

---

## Critical Implementation Details

### 1. Idempotency Key Generation
Use a deterministic key: `${campaignId}-${videoId}-${accountId}`. This means if the Campaign Runner generates jobs twice for the same video+account combination (e.g., after a resume), the `UNIQUE` constraint on `idempotency_key` prevents duplicate rows. The publisher also checks `publish_history` by `job_id` before publishing.

### 2. Atomic Job Claiming (prevents double-publish)
The publisher worker's claim step uses a conditional update:
```sql
UPDATE upload_jobs
SET status = 'preparing', claimed_by = $workerId, claimed_at = now()
WHERE id = $jobId AND status = 'queued' AND claimed_by IS NULL
```
If `count = 0`, another worker claimed it → skip immediately. This is the critical guard.

### 3. Signed URL Expiry for Instagram
Use **6 hours** (21600 seconds). Instagram starts downloading when you submit the container creation request but may take up to 30 minutes to process. A 6-hour window is safe. Generate the signed URL immediately before calling the API — not hours in advance.

### 4. computeNextSlot Function
This function is used by both the Campaign Runner (scheduling) and the preview API (UI). Factor it out into a shared pure function at `app/src/lib/publishing/schedule.ts` that both import:

```typescript
export function computeNextSlot(rule: ScheduleRule, from: Date): Date {
  // 1. Add frequencyHours to 'from'
  // 2. Convert to rule.timezone using date-fns-tz
  // 3. If time is before windowStart → set to windowStart on same day
  // 4. If time is after windowEnd → set to windowStart on next day
  // 5. Return
}
```

The Campaign Preview API calls this repeatedly to compute `firstPost` and `lastPost` without creating jobs.

### 5. Worker Hot-reload Safety
Unlike the Next.js app, the worker is a long-running Node.js process. No hot-reloading. On Railway, a new deploy restarts the service. Persist all state in Supabase — the worker has zero in-memory state. On restart, it picks up exactly where it left off.

### 6. R2 Bucket Configuration
- Create bucket in Cloudflare dashboard with **no public access** (private bucket)
- Create an R2 API token with **Object Read & Write** permissions
- No CORS configuration needed (the worker reads/writes server-to-server)
- Instagram fetches the video via the signed URL — this counts as S3-compatible presigned URL access, which R2 supports

### 7. Package Installation
In `app/`:
```bash
npm install @supabase/supabase-js @aws-sdk/client-s3 @aws-sdk/s3-request-presigner date-fns date-fns-tz
```

The worker at `worker/` uses the same packages from `app/node_modules` (since start command is `cd app && npx tsx ../worker/index.ts`).

### 8. Existing Code to Reuse
- `lib/clip/social/instagram.ts` — has the OAuth flow for connecting accounts. The worker's `instagram.ts` handles the publishing API calls (different concern). Don't merge them.
- `lib/llm-client.ts` — use for caption generation in the library caption API
- `lib/settings.ts` → `readSettings()` — use for the caption prompt template default
- `components/ui/` — all shadcn components are already installed

### 9. Downloader Settings Page Update
Remove the "Download directory" setting since videos now go to R2. The Settings page (`/downloader/settings`) should only show: Quality, Concurrent downloads, Retry count, Skip duplicates.

### 10. Campaign Runner Lock
The `locked_until` field in `campaign_runner_state` prevents two Campaign Runner ticks from processing the same campaign simultaneously. Before processing, check:
```typescript
const isLocked = state.locked_until && new Date(state.locked_until) > new Date() 
  && state.worker_id !== process.env.WORKER_ID;
if (isLocked) return; // another worker is currently generating jobs for this campaign
```
Lock duration: 60 seconds. If the worker crashes mid-generation, the lock expires and another tick picks up cleanly.

---

## Implementation Order

Implement phases in this strict order. Each phase is independently testable before the next begins.

**Phase 1:** Supabase client + run SQL schema + account migration script  
**Phase 2:** Storage abstraction (`lib/storage/types.ts`, `r2.ts`, `index.ts`) — test by uploading a file manually  
**Phase 3:** Downloader update — test by downloading one video and verifying it appears in Supabase `videos` table and R2  
**Phase 4:** Video Library API + UI — test by viewing the library grid with thumbnails loading  
**Phase 5:** Campaigns UI — test by creating a draft campaign and seeing the preview calculation  
**Phase 6:** Worker entry point + Campaign Runner + Publisher Worker — test with one campaign, one video, one account (test user)  
**Phase 7:** Queue page + Publish History page — verify jobs move through states and history inserts correctly  
**Phase 8:** Analytics Worker — implement last, verify it doesn't block any of the above  

---

## What NOT to Build Yet

- TikTok / YouTube Shorts / Facebook / LinkedIn publishing (architecture supports it, don't implement)
- Analytics charts or dashboards (Phase 2, leave fields nullable)
- Video editing before publishing (out of scope)
- Webhook-based job triggering (polling every 15s is sufficient)
- Paid analytics providers (Instagram Insights is free for connected accounts)
