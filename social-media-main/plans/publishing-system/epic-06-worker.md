# Epic 6 — Worker (Campaign Runner + Publisher)

## Objective

Build the Railway worker service: a standalone Node.js process that runs independently of the Next.js app. It has three responsibilities — generating upload jobs incrementally (Campaign Runner), executing due jobs against the Instagram API (Publisher Worker), and refreshing expiring access tokens. After this epic, end-to-end publishing works.

## Prerequisites

- Epic 5 complete (campaigns exist in Supabase with `status='running'` and seeded `campaign_runner_state`)
- At least one Instagram test account connected
- `WORKER_ID` environment variable set

## Scope

- `worker/index.ts` — entry point, starts all intervals
- `worker/lib/supabase.ts` — Supabase client for worker
- `worker/lib/storage.ts` — R2 client for worker
- `worker/campaign-runner.ts` — generates upload_jobs incrementally
- `worker/instagram-publisher.ts` — wraps Instagram Graph API (container create, poll, publish)
- `worker/publisher.ts` — orchestrates job claiming and calls `InstagramPublisher`
- `worker/token-refresh.ts` — refreshes tokens expiring within 7 days
- Railway second service configuration instructions

## Out of Scope

- Monitoring UI (Epic 7)
- Analytics fetching (not in v1)
- TikTok, YouTube, other platforms

---

## Worker File Location

All worker files live at `worker/` in the **project root** (same level as `app/`):

```
social-media-main/
  app/             ← Next.js app
  worker/          ← Worker service (new)
    index.ts
    campaign-runner.ts
    publisher.ts
    instagram-publisher.ts
    token-refresh.ts
    lib/
      supabase.ts
      storage.ts
```

The worker is **not** a Next.js app. It is plain TypeScript run with `tsx`.

**Start command on Railway:** `cd app && npx tsx ../worker/index.ts`

This works because:
- The worker's `cd app` puts it in the directory with `node_modules`
- `../worker/index.ts` is the entry point relative to `app/`
- The worker imports from `../app/src/lib/*` using relative paths

---

## Step 1 — Worker Supabase Client

Create `worker/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
```

---

## Step 2 — Worker Storage Client

Create `worker/lib/storage.ts`:

```typescript
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

/**
 * Generate a 6-hour signed URL for a storage key.
 * Called immediately before the Instagram API request.
 */
export async function getSignedVideoUrl(key: string, expiresInSeconds = 21600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}
```

---

## Step 3 — Instagram Publisher

Create `worker/instagram-publisher.ts`.

This module is the ONLY place that calls the Instagram Graph API. The Publisher Worker calls this — it does not call Instagram directly.

```typescript
const GRAPH_BASE = "https://graph.instagram.com/v21.0";

export interface PublishResult {
  mediaId: string;
}

/**
 * Step 1: Create a Reel media container.
 * Instagram will begin downloading the video from videoUrl immediately.
 * Returns the container ID.
 */
export async function createReelContainer(params: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;   // Must be a publicly accessible URL (signed R2 URL)
  caption: string;
}): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/${params.igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: params.videoUrl,
      caption: params.caption,
      share_to_feed: true,
      access_token: params.accessToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Instagram container creation failed: ${JSON.stringify(data)}`);
  }
  return data.id as string;
}

/**
 * Step 2: Poll until the container is ready.
 * Instagram processes the video asynchronously. This can take 30 seconds to 5 minutes.
 * Throws if status is ERROR or if timeout is reached.
 */
export async function waitForContainer(params: {
  accessToken: string;
  containerId: string;
  timeoutMs?: number;   // default: 10 minutes
}): Promise<void> {
  const timeoutMs = params.timeoutMs ?? 10 * 60 * 1000;
  const pollIntervalMs = 10_000;
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollIntervalMs);
    const res = await fetch(
      `${GRAPH_BASE}/${params.containerId}?fields=status_code,status&access_token=${params.accessToken}`
    );
    const data = await res.json();

    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(`Instagram container ${params.containerId} error: ${JSON.stringify(data)}`);
    }
    // IN_PROGRESS or PUBLISHED → keep polling
  }

  throw new Error(`Container ${params.containerId} timed out after ${timeoutMs / 1000}s`);
}

/**
 * Step 3: Publish the ready container.
 * Returns the Instagram media ID of the published Reel.
 */
export async function publishContainer(params: {
  igUserId: string;
  accessToken: string;
  containerId: string;
}): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/${params.igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: params.containerId,
      access_token: params.accessToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Instagram publish failed: ${JSON.stringify(data)}`);
  }
  return data.id as string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## Step 4 — Publisher Worker

Create `worker/publisher.ts`.

Responsibilities: claim jobs, check idempotency, call `InstagramPublisher`, update Supabase.

```typescript
import { supabase } from "./lib/supabase";
import { getSignedVideoUrl } from "./lib/storage";
import { createReelContainer, waitForContainer, publishContainer } from "./instagram-publisher";

const WORKER_ID = process.env.WORKER_ID ?? "worker-1";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15 * 60 * 1000; // 15 minutes
const JOBS_PER_TICK = 5;

export async function runPublisherTick(): Promise<void> {
  try {
    const now = new Date().toISOString();

    // 1. Find due, unclaimed jobs
    const { data: jobs, error } = await supabase
      .from("upload_jobs")
      .select(`
        id, video_id, account_id, idempotency_key, retry_count,
        instagram_container_id,
        videos ( storage_object_id, storage_objects ( key ) ),
        instagram_accounts ( ig_user_id, access_token, username ),
        video_captions ( caption, platform )
      `)
      .eq("status", "queued")
      .lte("scheduled_at", now)
      .is("claimed_by", null)
      .order("scheduled_at", { ascending: true })
      .limit(JOBS_PER_TICK);

    if (error) throw error;
    if (!jobs || jobs.length === 0) return;

    // 2. Process each job (fire-and-forget — don't await all)
    for (const job of jobs) {
      processJob(job).catch((err) =>
        console.error(`[Publisher] Unhandled error in job ${job.id}:`, err)
      );
    }
  } catch (err) {
    console.error("[Publisher] Tick error:", err);
  }
}

async function processJob(job: any): Promise<void> {
  // 3. Atomic claim — only one worker can claim a job
  const { count } = await supabase
    .from("upload_jobs")
    .update({
      status: "preparing",
      claimed_by: WORKER_ID,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "queued")         // guard: only update if still queued
    .is("claimed_by", null)         // guard: not already claimed
    .select("id", { count: "exact", head: true });

  if (!count || count === 0) {
    console.log(`[Publisher] Job ${job.id} already claimed by another worker — skipping`);
    return;
  }

  // 4. Idempotency check — already published?
  const { data: history } = await supabase
    .from("publish_history")
    .select("id")
    .eq("job_id", job.id)
    .limit(1);

  if (history && history.length > 0) {
    await supabase.from("upload_jobs").update({ status: "published" }).eq("id", job.id);
    console.log(`[Publisher] Job ${job.id} already in publish_history — marking published`);
    return;
  }

  // 5. Check daily limit for this account
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count: dailyCount } = await supabase
    .from("publish_history")
    .select("id", { count: "exact", head: true })
    .eq("account_id", job.account_id)
    .gte("published_at", todayStart.toISOString());

  if ((dailyCount ?? 0) >= 50) {
    // Daily limit hit — reschedule to tomorrow
    const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60_000);
    await supabase.from("upload_jobs").update({
      status: "queued",
      claimed_by: null,
      claimed_at: null,
      scheduled_at: tomorrow.toISOString(),
      error_message: "Daily post limit reached — rescheduled to tomorrow",
    }).eq("id", job.id);
    console.log(`[Publisher] Job ${job.id} daily limit reached — rescheduled`);
    return;
  }

  try {
    // 6. Get storage key for video
    const storageKey = job.videos?.storage_objects?.key;
    if (!storageKey) throw new Error("No storage key found for video");

    // 7. Get caption (prefer instagram platform caption)
    const caption =
      job.video_captions?.find((c: any) => c.platform === "instagram")?.caption ??
      job.video_captions?.[0]?.caption ??
      "";

    const account = job.instagram_accounts;
    if (!account) throw new Error("Instagram account not found");

    // 8. Generate 6-hour signed URL (do this immediately before API call)
    const signedUrl = await getSignedVideoUrl(storageKey, 21600);

    // 9. Create container
    await supabase.from("upload_jobs").update({ status: "uploading" }).eq("id", job.id);
    const containerId = await createReelContainer({
      igUserId: account.ig_user_id,
      accessToken: account.access_token,
      videoUrl: signedUrl,
      caption,
    });

    await supabase.from("upload_jobs").update({
      status: "waiting_for_instagram",
      instagram_container_id: containerId,
    }).eq("id", job.id);

    // 10. Wait for Instagram to process the video
    await waitForContainer({ accessToken: account.access_token, containerId });

    // 11. Publish
    await supabase.from("upload_jobs").update({ status: "publishing" }).eq("id", job.id);
    const mediaId = await publishContainer({
      igUserId: account.ig_user_id,
      accessToken: account.access_token,
      containerId,
    });

    // 12. Mark job published
    const publishedAt = new Date().toISOString();
    await supabase.from("upload_jobs").update({
      status: "published",
      instagram_media_id: mediaId,
      published_at: publishedAt,
    }).eq("id", job.id);

    // 13. Insert immutable history row (append-only, never update this)
    await supabase.from("publish_history").insert({
      job_id: job.id,
      video_id: job.video_id,
      account_id: job.account_id,
      instagram_media_id: mediaId,
      published_at: publishedAt,
    });

    // 14. Update video publish_status if not already published
    await supabase
      .from("videos")
      .update({ publish_status: "published" })
      .eq("id", job.video_id)
      .eq("publish_status", "unpublished");

    console.log(`[Publisher] ✓ Job ${job.id} published → Instagram media ${mediaId}`);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const newRetryCount = (job.retry_count ?? 0) + 1;

    if (newRetryCount >= MAX_RETRIES) {
      await supabase.from("upload_jobs").update({
        status: "failed",
        error_message: errorMessage,
        retry_count: newRetryCount,
      }).eq("id", job.id);
      console.error(`[Publisher] ✗ Job ${job.id} failed permanently: ${errorMessage}`);
    } else {
      const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      await supabase.from("upload_jobs").update({
        status: "queued",
        error_message: errorMessage,
        retry_count: newRetryCount,
        claimed_by: null,
        claimed_at: null,
        scheduled_at: retryAt,
      }).eq("id", job.id);
      console.warn(`[Publisher] Job ${job.id} retry ${newRetryCount}/${MAX_RETRIES} at ${retryAt}`);
    }
  }
}
```

---

## Step 5 — Campaign Runner

Create `worker/campaign-runner.ts`.

Generates the next batch of upload_jobs for each running campaign.

```typescript
import { supabase } from "./lib/supabase";
import { computeFirstSlot, computeNextSlot } from "../app/src/lib/services/schedule-service";
import { v4 as uuid } from "uuid";
import type { ScheduleRule } from "../app/src/lib/db/types";

const WORKER_ID = process.env.WORKER_ID ?? "worker-1";
const BATCH_SIZE = 50;        // generate at most 50 video-slots per tick
const LOCK_DURATION_MS = 60_000; // 60 second lock per campaign

export async function runCampaignRunnerTick(): Promise<void> {
  try {
    // 1. Find all running campaigns
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id")
      .eq("status", "running");

    if (!campaigns || campaigns.length === 0) return;

    for (const campaign of campaigns) {
      await processCampaign(campaign.id).catch((err) =>
        console.error(`[CampaignRunner] Error processing campaign ${campaign.id}:`, err)
      );
    }
  } catch (err) {
    console.error("[CampaignRunner] Tick error:", err);
  }
}

async function processCampaign(campaignId: string): Promise<void> {
  const now = new Date();

  // 2. Try to acquire lock
  const { data: existingState } = await supabase
    .from("campaign_runner_state")
    .select("*")
    .eq("campaign_id", campaignId)
    .single();

  // If locked by another worker and lock hasn't expired, skip
  if (
    existingState?.locked_until &&
    new Date(existingState.locked_until) > now &&
    existingState.worker_id !== WORKER_ID
  ) {
    return;
  }

  // Acquire/renew lock
  const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS).toISOString();
  const { error: lockError } = await supabase
    .from("campaign_runner_state")
    .upsert({
      campaign_id: campaignId,
      cursor: existingState?.cursor ?? 0,
      last_tick: now.toISOString(),
      locked_until: lockedUntil,
      worker_id: WORKER_ID,
    });
  if (lockError) return; // race condition, another worker won

  const cursor = existingState?.cursor ?? 0;

  // 3. Load campaign + ordered videos + accounts
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("schedule_rule, caption_prompt_template")
    .eq("id", campaignId)
    .single();
  if (!campaign) return;

  const { data: campaignVideos } = await supabase
    .from("campaign_videos")
    .select("video_id, position")
    .eq("campaign_id", campaignId)
    .eq("skipped", false)
    .gt("position", cursor)
    .order("position", { ascending: true })
    .limit(BATCH_SIZE);

  const { data: campaignAccounts } = await supabase
    .from("campaign_accounts")
    .select("account_id")
    .eq("campaign_id", campaignId);

  if (!campaignVideos || campaignVideos.length === 0) {
    // All videos scheduled — mark campaign completed
    await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaignId);
    await supabase.from("campaign_runner_state")
      .update({ locked_until: null })
      .eq("campaign_id", campaignId);
    console.log(`[CampaignRunner] Campaign ${campaignId} completed — all videos scheduled`);
    return;
  }

  const accountIds = (campaignAccounts ?? []).map((a: any) => a.account_id);
  if (accountIds.length === 0) return;

  const rule: ScheduleRule = campaign.schedule_rule as ScheduleRule;

  // 4. Find the last scheduled_at for this campaign to continue from
  const { data: lastJob } = await supabase
    .from("upload_jobs")
    .select("scheduled_at")
    .eq("campaign_id", campaignId)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .single();

  let slotTime = lastJob?.scheduled_at
    ? computeNextSlot(rule, new Date(lastJob.scheduled_at))
    : computeFirstSlot(rule);

  // 5. Generate jobs
  const jobs: any[] = [];
  let newCursor = cursor;

  for (const cv of campaignVideos) {
    const jitterMs =
      rule.randomizeMinutes > 0
        ? (Math.random() * 2 - 1) * rule.randomizeMinutes * 60_000
        : 0;
    const scheduledAt = new Date(slotTime.getTime() + jitterMs).toISOString();

    for (const accountId of accountIds) {
      jobs.push({
        campaign_id: campaignId,
        video_id: cv.video_id,
        account_id: accountId,
        scheduled_at: scheduledAt,
        idempotency_key: `${campaignId}-${cv.video_id}-${accountId}`,
        status: "queued",
        retry_count: 0,
      });
    }

    slotTime = computeNextSlot(rule, slotTime);
    newCursor = cv.position;
  }

  // 6. Bulk insert (ON CONFLICT DO NOTHING due to unique idempotency_key)
  if (jobs.length > 0) {
    const { error } = await supabase.from("upload_jobs").insert(jobs);
    if (error && !error.message.includes("duplicate")) {
      throw new Error(`Failed to insert jobs: ${error.message}`);
    }
    console.log(`[CampaignRunner] Campaign ${campaignId}: generated ${jobs.length} jobs, cursor → ${newCursor}`);
  }

  // 7. Update cursor and release lock
  await supabase.from("campaign_runner_state").update({
    cursor: newCursor,
    last_tick: now.toISOString(),
    locked_until: null,
    worker_id: null,
  }).eq("campaign_id", campaignId);
}
```

---

## Step 6 — Token Refresh

Create `worker/token-refresh.ts`:

```typescript
import { supabase } from "./lib/supabase";

export async function runTokenRefreshTick(): Promise<void> {
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
      } else {
        throw new Error(JSON.stringify(data));
      }
    } catch (err) {
      console.error(`[TokenRefresh] Failed for account ${account.id}:`, err);
      await supabase.from("instagram_accounts")
        .update({ status: "needs_reauth" })
        .eq("id", account.id);
    }
  }
}
```

---

## Step 7 — Worker Entry Point

Create `worker/index.ts`:

```typescript
import "dotenv/config"; // loads .env for local development
import { runPublisherTick } from "./publisher";
import { runCampaignRunnerTick } from "./campaign-runner";
import { runTokenRefreshTick } from "./token-refresh";

const PUBLISHER_INTERVAL_MS = 15_000;       // 15 seconds
const CAMPAIGN_RUNNER_INTERVAL_MS = 5 * 60_000; // 5 minutes
const TOKEN_REFRESH_INTERVAL_MS = 60 * 60_000;  // 1 hour

console.log(`[Worker] Starting. WORKER_ID=${process.env.WORKER_ID ?? "worker-1"}`);

// Run immediately on start, then on interval
runCampaignRunnerTick();
setInterval(runCampaignRunnerTick, CAMPAIGN_RUNNER_INTERVAL_MS);

runPublisherTick();
setInterval(runPublisherTick, PUBLISHER_INTERVAL_MS);

runTokenRefreshTick();
setInterval(runTokenRefreshTick, TOKEN_REFRESH_INTERVAL_MS);

console.log("[Worker] All intervals started.");

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[Worker] SIGTERM received — shutting down.");
  process.exit(0);
});
```

Install `dotenv` for local development: `npm install dotenv` in the `app/` directory.

---

## Step 8 — Railway Worker Service Configuration

Manual steps the developer must do in Railway:

1. Go to Railway dashboard → Project → Add Service → From GitHub Repo
2. Select the same repository
3. Set root directory: `app` (same as the main service)
4. Set start command: `npx tsx ../worker/index.ts`
5. Add all the same environment variables as the main service, plus `WORKER_ID=worker-1`
6. Deploy

The worker service and the Next.js service share the same env vars but run as separate processes.

---

## Acceptance Criteria

Epic 6 is complete when ALL of the following are true:

- [ ] `worker/index.ts` starts without errors locally: `cd app && npx tsx ../worker/index.ts`
- [ ] Campaign Runner tick runs and generates `upload_jobs` rows in Supabase for a running campaign
- [ ] `upload_jobs` rows have correct `scheduled_at`, `video_id`, `account_id`, `idempotency_key`
- [ ] Running Campaign Runner twice does NOT create duplicate jobs (idempotency_key constraint)
- [ ] Publisher Worker claims a due job (verify `status` changes from `queued` → `preparing` → `uploading` → `waiting_for_instagram` → `publishing` → `published`)
- [ ] After publishing: a row exists in `publish_history` with `instagram_media_id`
- [ ] The published Reel appears on the test Instagram account
- [ ] If a job fails: `retry_count` increments and job is rescheduled 15 minutes later
- [ ] After 3 failures: job status = `failed`, not retried again
- [ ] Two worker ticks do NOT publish the same job twice (atomic claim guard works)
- [ ] `token_expires_at` is updated after `runTokenRefreshTick()` runs on a nearly-expired account
- [ ] No TypeScript errors
- [ ] Existing clipping pipeline is completely unaffected
