# Epic 1 — Foundation (Supabase + Repository Layer)

## Objective

Set up Supabase as the database, create the full schema via migration files, migrate existing Instagram accounts from the current JSON store into Supabase, and build a typed repository layer that every subsequent epic depends on. No UI. No R2. No downloader changes.

## Scope

- Install `@supabase/supabase-js`
- Supabase server client + public client
- SQL migration file (`001_initial_schema.sql`)
- 6 typed repositories
- Account migration script
- Check and extend `lib/db/` if it already exists (do not overwrite)

## Out of Scope

- Cloudflare R2 (Epic 2)
- Downloader changes (Epic 3)
- Any UI changes (Epics 4–5)
- Worker (Epic 6)
- Sidebar changes (Epic 4)

---

## Step 1 — Install Dependencies

```bash
cd app
npm install @supabase/supabase-js
```

---

## Step 2 — Supabase Clients

**Check first:** Read `app/src/lib/db/index.ts` if it exists. If it already exports a Supabase client, extend it rather than creating a duplicate.

Create `app/src/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

/**
 * Server-side Supabase client. Uses service role key — full database access.
 * Never import this in client components or expose to the browser.
 */
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/**
 * Public Supabase client. Uses anon key — safe for browser use.
 * Only needed for real-time subscriptions (future). All data fetching
 * goes through API routes using supabaseServer.
 */
export const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

---

## Step 3 — SQL Migration

Create `supabase/migrations/001_initial_schema.sql`.

Claude must generate the full SQL. The schema must match exactly:

**Tables to create (in dependency order):**

### `storage_objects`
```
id            uuid PK default gen_random_uuid()
provider      text NOT NULL default 'r2'
bucket        text NOT NULL
key           text NOT NULL          -- e.g. "videos/abc123.mp4"
mime_type     text
size_bytes    bigint
checksum      text                   -- SHA-256 hex
version       int NOT NULL default 1
is_current    boolean NOT NULL default true
created_at    timestamptz default now()
deleted_at    timestamptz
```
Indexes: `checksum`, `(key, is_current)`

### `instagram_accounts`
```
id               uuid PK default gen_random_uuid()
ig_user_id       text UNIQUE NOT NULL
username         text NOT NULL
display_name     text
access_token     text NOT NULL
token_expires_at timestamptz
status           text NOT NULL default 'connected'
                 -- connected | needs_reauth | disconnected
last_posted_at   timestamptz
created_at       timestamptz default now()
```
Indexes: `status`

### `videos`
```
id                  uuid PK default gen_random_uuid()
storage_object_id   uuid REFERENCES storage_objects(id)
thumbnail_object_id uuid REFERENCES storage_objects(id)
title               text NOT NULL
creator             text
platform            text              -- youtube | instagram | unknown
duration_sec        int
original_url        text
storage_status      text NOT NULL default 'available'
                    -- available | deleted
publish_status      text NOT NULL default 'unpublished'
                    -- unpublished | scheduled | published
downloaded_at       timestamptz default now()
```
Indexes: `platform`, `(storage_status, publish_status)`

### `video_captions`
```
id          uuid PK default gen_random_uuid()
video_id    uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE
platform    text NOT NULL default 'instagram'
language    text NOT NULL default 'en'
caption     text NOT NULL
created_at  timestamptz default now()
UNIQUE(video_id, platform, language)
```

### `campaigns`
```
id                      uuid PK default gen_random_uuid()
name                    text NOT NULL
status                  text NOT NULL default 'draft'
                        -- draft | ready | scheduled | running | paused | completed | cancelled
caption_prompt_template text
assignment_mode         text NOT NULL default 'crosspost'
schedule_rule           jsonb NOT NULL default '{}'
timezone                text NOT NULL default 'UTC'
starts_at               timestamptz
created_at              timestamptz default now()
updated_at              timestamptz default now()
```

### `campaign_runner_state`
```
campaign_id  uuid PK REFERENCES campaigns(id) ON DELETE CASCADE
cursor       int NOT NULL default 0
last_tick    timestamptz
locked_until timestamptz
worker_id    text
```

### `campaign_videos`
```
id           uuid PK default gen_random_uuid()
campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE
video_id     uuid NOT NULL REFERENCES videos(id)
position     int NOT NULL
skipped      boolean NOT NULL default false
UNIQUE(campaign_id, video_id)
```
Index: `(campaign_id, position)`

### `campaign_accounts`
```
campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE
account_id   uuid NOT NULL REFERENCES instagram_accounts(id)
PRIMARY KEY(campaign_id, account_id)
```

### `upload_jobs`
```
id                      uuid PK default gen_random_uuid()
campaign_id             uuid REFERENCES campaigns(id)
video_id                uuid NOT NULL REFERENCES videos(id)
account_id              uuid NOT NULL REFERENCES instagram_accounts(id)
scheduled_at            timestamptz NOT NULL
idempotency_key         text UNIQUE NOT NULL
status                  text NOT NULL default 'queued'
                        -- queued | preparing | uploading | waiting_for_instagram
                        -- | publishing | published | failed | cancelled
retry_count             int NOT NULL default 0
error_message           text
claimed_by              text
claimed_at              timestamptz
instagram_container_id  text
instagram_media_id      text
published_at            timestamptz
created_at              timestamptz default now()
```
Indexes: `(status, scheduled_at)`, `campaign_id`, `(account_id, scheduled_at)`

### `publish_history`
```
id                   uuid PK default gen_random_uuid()
job_id               uuid REFERENCES upload_jobs(id)
video_id             uuid NOT NULL REFERENCES videos(id)
account_id           uuid NOT NULL REFERENCES instagram_accounts(id)
instagram_media_id   text
permalink            text
published_at         timestamptz NOT NULL default now()
views_count          bigint       -- nullable, populated later
likes_count          bigint       -- nullable
comments_count       bigint       -- nullable
reach                bigint       -- nullable
analytics_fetched_at timestamptz  -- nullable
```
Indexes: `(account_id, published_at)`, `analytics_fetched_at` WHERE NULL

**Run the migration** using the Supabase dashboard SQL editor or the Supabase CLI (`supabase db push`).

---

## Step 4 — TypeScript Types

Create `app/src/lib/db/types.ts` with TypeScript interfaces matching every table exactly. These are the types used by all repositories.

```typescript
export type StorageStatus = "available" | "deleted";
export type PublishStatus = "unpublished" | "scheduled" | "published";
export type AccountStatus = "connected" | "needs_reauth" | "disconnected";
export type CampaignStatus = "draft" | "ready" | "scheduled" | "running" | "paused" | "completed" | "cancelled";
export type JobStatus =
  | "queued" | "preparing" | "uploading" | "waiting_for_instagram"
  | "publishing" | "published" | "failed" | "cancelled";

export interface StorageObject {
  id: string;
  provider: string;
  bucket: string;
  key: string;
  mime_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  version: number;
  is_current: boolean;
  created_at: string;
  deleted_at: string | null;
}

export interface InstagramAccount {
  id: string;
  ig_user_id: string;
  username: string;
  display_name: string | null;
  access_token: string;
  token_expires_at: string | null;
  status: AccountStatus;
  last_posted_at: string | null;
  created_at: string;
}

export interface Video {
  id: string;
  storage_object_id: string | null;
  thumbnail_object_id: string | null;
  title: string;
  creator: string | null;
  platform: string | null;
  duration_sec: number | null;
  original_url: string | null;
  storage_status: StorageStatus;
  publish_status: PublishStatus;
  downloaded_at: string;
}

export interface VideoCaption {
  id: string;
  video_id: string;
  platform: string;
  language: string;
  caption: string;
  created_at: string;
}

export interface ScheduleRule {
  frequencyHours: number;      // e.g. 3
  windowStart: string;         // "09:00" local time
  windowEnd: string;           // "22:00"
  timezone: string;            // "Asia/Kolkata"
  randomizeMinutes: number;    // ±minutes jitter, 0 = no jitter
  startDate: string;           // "2026-07-01" ISO date
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  caption_prompt_template: string | null;
  assignment_mode: "crosspost" | "distribute";
  schedule_rule: ScheduleRule;
  timezone: string;
  starts_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignRunnerState {
  campaign_id: string;
  cursor: number;
  last_tick: string | null;
  locked_until: string | null;
  worker_id: string | null;
}

export interface CampaignVideo {
  id: string;
  campaign_id: string;
  video_id: string;
  position: number;
  skipped: boolean;
}

export interface UploadJob {
  id: string;
  campaign_id: string | null;
  video_id: string;
  account_id: string;
  scheduled_at: string;
  idempotency_key: string;
  status: JobStatus;
  retry_count: number;
  error_message: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  instagram_container_id: string | null;
  instagram_media_id: string | null;
  published_at: string | null;
  created_at: string;
}

export interface PublishHistory {
  id: string;
  job_id: string | null;
  video_id: string;
  account_id: string;
  instagram_media_id: string | null;
  permalink: string | null;
  published_at: string;
  views_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  reach: number | null;
  analytics_fetched_at: string | null;
}
```

---

## Step 5 — Repository Layer

Create one file per repository under `app/src/lib/db/repositories/`. Each repository is a plain object (not a class) that wraps Supabase queries. All methods are async. No business logic — only data access.

### `app/src/lib/db/repositories/storage-object-repository.ts`

```typescript
import { supabaseServer } from "@/lib/supabase";
import type { StorageObject } from "@/lib/db/types";

export const storageObjectRepository = {
  async findByChecksum(checksum: string): Promise<StorageObject | null> {
    const { data } = await supabaseServer
      .from("storage_objects")
      .select("*")
      .eq("checksum", checksum)
      .eq("is_current", true)
      .limit(1)
      .single();
    return data ?? null;
  },

  async findById(id: string): Promise<StorageObject | null> {
    const { data } = await supabaseServer
      .from("storage_objects")
      .select("*")
      .eq("id", id)
      .single();
    return data ?? null;
  },

  async create(input: Omit<StorageObject, "id" | "created_at" | "deleted_at" | "version" | "is_current">): Promise<StorageObject> {
    const { data, error } = await supabaseServer
      .from("storage_objects")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`storageObjectRepository.create: ${error.message}`);
    return data;
  },

  async markDeleted(id: string): Promise<void> {
    const { error } = await supabaseServer
      .from("storage_objects")
      .update({ deleted_at: new Date().toISOString(), is_current: false })
      .eq("id", id);
    if (error) throw new Error(`storageObjectRepository.markDeleted: ${error.message}`);
  },
};
```

### `app/src/lib/db/repositories/account-repository.ts`

Methods:
- `findAll(status?: AccountStatus): Promise<InstagramAccount[]>` — optionally filter by status
- `findById(id: string): Promise<InstagramAccount | null>`
- `findByIgUserId(igUserId: string): Promise<InstagramAccount | null>`
- `upsert(data: Omit<InstagramAccount, "id" | "created_at">): Promise<InstagramAccount>` — use `onConflict: "ig_user_id"`
- `update(id: string, data: Partial<InstagramAccount>): Promise<void>`
- `delete(id: string): Promise<void>`

All errors should throw with the format `accountRepository.{methodName}: {error.message}`.

### `app/src/lib/db/repositories/video-repository.ts`

```typescript
export interface VideoFilters {
  platform?: string;
  storage_status?: StorageStatus;
  publish_status?: PublishStatus;
  creator?: string;
  search?: string;    // matches title ILIKE %search%
  limit?: number;
  offset?: number;
}
```

Methods:
- `findAll(filters?: VideoFilters): Promise<Video[]>` — applies all filters, default limit 50
- `findById(id: string): Promise<Video | null>`
- `findByChecksum(checksum: string): Promise<{ videoId: string } | null>` — join storage_objects on checksum, return video id if exists
- `create(data: Omit<Video, "downloaded_at">): Promise<Video>`
- `update(id: string, data: Partial<Pick<Video, "storage_status" | "publish_status" | "title" | "creator">>): Promise<void>`
- `delete(id: string): Promise<void>` — sets storage_status = 'deleted'
- `countAll(filters?: Omit<VideoFilters, "limit" | "offset">): Promise<number>`

### `app/src/lib/db/repositories/video-caption-repository.ts`

Methods:
- `findByVideo(videoId: string, platform?: string): Promise<VideoCaption[]>`
- `upsert(data: Omit<VideoCaption, "id" | "created_at">): Promise<VideoCaption>` — onConflict `(video_id, platform, language)`
- `delete(videoId: string, platform: string): Promise<void>`

### `app/src/lib/db/repositories/campaign-repository.ts`

Methods:
- `findAll(): Promise<Campaign[]>` — ordered by created_at desc
- `findById(id: string): Promise<Campaign | null>`
- `findByStatus(status: CampaignStatus): Promise<Campaign[]>`
- `create(data: Omit<Campaign, "id" | "created_at" | "updated_at">): Promise<Campaign>`
- `update(id: string, data: Partial<Omit<Campaign, "id" | "created_at">>): Promise<Campaign>`
- `delete(id: string): Promise<void>`
- `getVideos(campaignId: string): Promise<CampaignVideo[]>` — ordered by position
- `addVideo(campaignId: string, videoId: string, position: number): Promise<void>`
- `removeVideo(campaignId: string, videoId: string): Promise<void>`
- `reorderVideos(campaignId: string, orderedVideoIds: string[]): Promise<void>` — updates position for each
- `getAccounts(campaignId: string): Promise<string[]>` — returns account_id array
- `addAccount(campaignId: string, accountId: string): Promise<void>`
- `removeAccount(campaignId: string, accountId: string): Promise<void>`
- `getRunnerState(campaignId: string): Promise<CampaignRunnerState | null>`
- `upsertRunnerState(state: CampaignRunnerState): Promise<void>`
- `updateRunnerCursor(campaignId: string, cursor: number): Promise<void>`

### `app/src/lib/db/repositories/upload-job-repository.ts`

Methods:
- `findDue(limit: number): Promise<UploadJob[]>` — status='queued' AND scheduled_at <= now() AND claimed_by IS NULL, ordered by scheduled_at ASC
- `claim(jobId: string, workerId: string): Promise<boolean>` — atomic UPDATE WHERE status='queued' AND claimed_by IS NULL, returns true if claimed (rowcount > 0)
- `updateStatus(jobId: string, status: JobStatus, extra?: Partial<UploadJob>): Promise<void>`
- `create(data: Omit<UploadJob, "id" | "created_at">): Promise<UploadJob>`
- `createMany(data: Omit<UploadJob, "id" | "created_at">[]): Promise<void>` — bulk insert
- `findByCampaign(campaignId: string, statusFilter?: JobStatus[]): Promise<UploadJob[]>`
- `findById(id: string): Promise<UploadJob | null>`
- `cancel(jobId: string): Promise<void>` — sets status='cancelled' if not already published
- `resetFailed(jobId: string): Promise<void>` — sets status='queued', clears error, resets retry_count=0, claimed_by=null

### `app/src/lib/db/repositories/publish-history-repository.ts`

**This repository never updates existing rows.** All writes are inserts.

Methods:
- `insert(data: Omit<PublishHistory, "id">): Promise<void>` — append only
- `findByAccount(accountId: string, since: Date): Promise<PublishHistory[]>`
- `countTodayByAccount(accountId: string): Promise<number>` — COUNT where published_at >= start of today (UTC)
- `findAll(filters?: { accountId?: string; since?: string; until?: string; limit?: number }): Promise<PublishHistory[]>`
- `findPendingAnalytics(limit: number): Promise<PublishHistory[]>` — analytics_fetched_at IS NULL AND published_at < 1 hour ago
- `updateAnalytics(id: string, metrics: { views_count: number; likes_count: number; comments_count: number; reach: number }): Promise<void>` — this is the ONLY update method allowed (populating analytics)

---

## Step 6 — Repository Index

Create `app/src/lib/db/repositories/index.ts`:

```typescript
export { storageObjectRepository } from "./storage-object-repository";
export { accountRepository } from "./account-repository";
export { videoRepository } from "./video-repository";
export { videoCaptionRepository } from "./video-caption-repository";
export { campaignRepository } from "./campaign-repository";
export { uploadJobRepository } from "./upload-job-repository";
export { publishHistoryRepository } from "./publish-history-repository";
```

**Check:** If `app/src/lib/db/index.ts` already exists and exports `repos`, add the new repositories to it without removing existing ones.

---

## Step 7 — Account Migration Script

Create `scripts/migrate-accounts.ts` (at project root, not inside `app/`).

This script:
1. Reads existing Instagram accounts from wherever `/clip/social` stores them. Check `app/src/lib/clip/store.ts` and look for a function that reads social accounts. If the store reads from `data/social-accounts.json`, read that file.
2. For each existing account, calls `accountRepository.upsert()` using the existing `ig_user_id`, `username`, `access_token`, `token_expires_at`.
3. Prints "Migrated N accounts" on completion.

Run with: `cd app && npx tsx ../scripts/migrate-accounts.ts`

The script must handle the case where `data/social-accounts.json` does not exist (print "No accounts to migrate" and exit cleanly).

---

## Acceptance Criteria

Epic 1 is complete when ALL of the following are true:

- [ ] `supabase/migrations/001_initial_schema.sql` exists and can be run on a fresh Supabase project without errors
- [ ] All 9 tables exist in Supabase with correct columns, constraints, and indexes
- [ ] `app/src/lib/supabase.ts` exports `supabaseServer` and `supabasePublic`
- [ ] `app/src/lib/db/types.ts` exports all TypeScript interfaces
- [ ] All 7 repository files exist with fully implemented methods (no stubs)
- [ ] `scripts/migrate-accounts.ts` runs without error
- [ ] Existing accounts from `/clip/social` appear in the `instagram_accounts` table
- [ ] The existing clipping pipeline is completely unaffected (run a test clip to verify)
- [ ] No TypeScript errors (`cd app && npx tsc --noEmit`)
