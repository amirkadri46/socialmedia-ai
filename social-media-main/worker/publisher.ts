import { supabase } from "./lib/supabase";
import { getSignedVideoUrl } from "./lib/storage";
import { createReelContainer, waitForContainer, publishContainer } from "./instagram-publisher";

const WORKER_ID = process.env.WORKER_ID ?? "worker-1";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15 * 60 * 1000;
const JOBS_PER_TICK = 5;
// Jobs stuck in intermediate states longer than this are considered orphaned (crash recovery)
const STALE_JOB_THRESHOLD_MS = 15 * 60 * 1000;
let tickRunning = false;
const activeJobs = new Set<string>();

export async function runPublisherTick(): Promise<void> {
  if (tickRunning) {
    console.log("[Publisher] Previous tick still running - skipping");
    return;
  }
  tickRunning = true;
  const tickStarted = Date.now();
  try {
    const now = new Date().toISOString();

    // Reclaim jobs orphaned by a crashed worker (finding #6)
    const staleThreshold = new Date(Date.now() - STALE_JOB_THRESHOLD_MS).toISOString();
    const { data: staleJobs } = await supabase
      .from("pub_upload_jobs")
      .select("id")
      .in("status", ["preparing", "uploading", "waiting_for_instagram", "publishing"])
      .lt("claimed_at", staleThreshold);
    if (staleJobs && staleJobs.length > 0) {
      await supabase
        .from("pub_upload_jobs")
        .update({ status: "queued", claimed_by: null, claimed_at: null })
        .in("id", staleJobs.map((j: any) => j.id));
      console.log(`[Publisher] Reclaimed ${staleJobs.length} stale job(s)`);
    }

    const { data: jobs, error } = await supabase
      .from("pub_upload_jobs")
      .select(`
        id, campaign_id, video_id, account_id, idempotency_key, retry_count,
        instagram_container_id,
        pub_videos ( storage_object_id, pub_storage_objects ( key ) ),
        pub_instagram_accounts ( ig_user_id, access_token, username ),
        pub_video_captions ( caption, platform )
      `)
      .eq("status", "queued")
      .lte("scheduled_at", now)
      .is("claimed_by", null)
      .order("scheduled_at", { ascending: true })
      .limit(JOBS_PER_TICK);

    if (error) throw error;
    if (!jobs || jobs.length === 0) return;

    console.log(`[Publisher] Processing ${jobs.length} due job(s)`);
    const results = await Promise.allSettled(jobs.map((job: unknown) => processJob(job)));
    const failed = results.filter((result: PromiseSettledResult<void>) => result.status === "rejected").length;
    console.log(`[Publisher] Tick complete in ${Date.now() - tickStarted}ms (${jobs.length - failed}/${jobs.length} settled)`);
  } catch (err) {
    console.error("[Publisher] Tick error:", err);
  } finally {
    tickRunning = false;
  }
}

export async function resetClaimedJobs(): Promise<void> {
  const { error } = await supabase
    .from("pub_upload_jobs")
    .update({ status: "queued", claimed_by: null, claimed_at: null })
    .eq("claimed_by", WORKER_ID)
    .in("status", ["preparing", "uploading", "waiting_for_instagram", "publishing"]);
  if (error) console.error("[Publisher] Failed to reset claimed jobs on shutdown:", error);
}

async function processJob(job: any): Promise<void> {
  if (activeJobs.has(job.id)) {
    console.log(`[Publisher] Job ${job.id} already active in this process - skipping`);
    return;
  }
  activeJobs.add(job.id);
  try {
  // Atomic claim — only one worker wins; distinguish a lost race from a DB error (finding #2)
  const { count, error: claimError } = await supabase
    .from("pub_upload_jobs")
    .update({
      status: "preparing",
      claimed_by: WORKER_ID,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .is("claimed_by", null)
    .select("id", { count: "exact", head: true });

  if (claimError) {
    console.error(`[Publisher] Claim DB error for job ${job.id}:`, claimError);
    return;
  }
  if (!count || count === 0) {
    console.log(`[Publisher] Job ${job.id} already claimed by another worker — skipping`);
    return;
  }
  if (job.campaign_id) {
    await supabase.from("pub_campaigns").update({ status: "running" }).eq("id", job.campaign_id);
  }

  const { data: history } = await supabase
    .from("pub_publish_history")
    .select("id")
    .eq("job_id", job.id)
    .limit(1);

  if (history && history.length > 0) {
    await supabase.from("pub_upload_jobs").update({ status: "published" }).eq("id", job.id);
    console.log(`[Publisher] Job ${job.id} already in publish_history — marking published`);
    return;
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count: dailyCount } = await supabase
    .from("pub_publish_history")
    .select("id", { count: "exact", head: true })
    .eq("account_id", job.account_id)
    .gte("published_at", todayStart.toISOString());

  if ((dailyCount ?? 0) >= 50) {
    const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60_000);
    await supabase.from("pub_upload_jobs").update({
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
    const storageKey = job.pub_videos?.pub_storage_objects?.key;
    if (!storageKey) throw new Error("No storage key found for video");

    const caption =
      job.pub_video_captions?.find((c: any) => c.platform === "instagram")?.caption ??
      job.pub_video_captions?.[0]?.caption ??
      "";

    const account = job.pub_instagram_accounts;
    if (!account) throw new Error("Instagram account not found");

    const signedUrl = await getSignedVideoUrl(storageKey, 21600);

    await supabase.from("pub_upload_jobs").update({ status: "uploading" }).eq("id", job.id);
    const containerId = await createReelContainer({
      igUserId: account.ig_user_id,
      accessToken: account.access_token,
      videoUrl: signedUrl,
      caption,
    });

    await supabase.from("pub_upload_jobs").update({
      status: "waiting_for_instagram",
      instagram_container_id: containerId,
    }).eq("id", job.id);

    await waitForContainer({ accessToken: account.access_token, containerId });

    await supabase.from("pub_upload_jobs").update({ status: "publishing" }).eq("id", job.id);
    const mediaId = await publishContainer({
      igUserId: account.ig_user_id,
      accessToken: account.access_token,
      containerId,
    });

    const publishedAt = new Date().toISOString();

    // Insert history FIRST — it acts as the idempotency fence (finding #1).
    // If the job update below fails and the job is re-queued, the idempotency
    // check at the top will catch the existing history row and mark it published
    // without re-publishing to Instagram.
    await supabase.from("pub_publish_history").insert({
      job_id: job.id,
      video_id: job.video_id,
      account_id: job.account_id,
      instagram_media_id: mediaId,
      published_at: publishedAt,
    });

    await supabase.from("pub_upload_jobs").update({
      status: "published",
      instagram_media_id: mediaId,
      published_at: publishedAt,
    }).eq("id", job.id);

    await supabase
      .from("pub_videos")
      .update({ publish_status: "published" })
      .eq("id", job.video_id)
      .eq("publish_status", "unpublished");

    if (job.campaign_id) await refreshCampaignStatus(job.campaign_id);

    console.log(`[Publisher] ✓ Job ${job.id} published → Instagram media ${mediaId}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const newRetryCount = (job.retry_count ?? 0) + 1;

    if (newRetryCount >= MAX_RETRIES) {
      await supabase.from("pub_upload_jobs").update({
        status: "failed",
        error_message: errorMessage,
        retry_count: newRetryCount,
      }).eq("id", job.id);
      if (job.campaign_id) await refreshCampaignStatus(job.campaign_id);
      console.error(`[Publisher] ✗ Job ${job.id} failed permanently: ${errorMessage}`);
    } else {
      const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      await supabase.from("pub_upload_jobs").update({
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
  } finally {
    activeJobs.delete(job.id);
  }
}

async function refreshCampaignStatus(campaignId: string): Promise<void> {
  const { data: jobs } = await supabase
    .from("pub_upload_jobs")
    .select("status")
    .eq("campaign_id", campaignId);
  const statuses = (jobs ?? []).map((j: { status: string }) => j.status);
  if (statuses.length === 0) return;
  if (statuses.some((s: string) => s === "failed")) {
    await supabase.from("pub_campaigns").update({ status: "failed" }).eq("id", campaignId);
  } else if (statuses.every((s: string) => s === "published")) {
    await supabase.from("pub_campaigns").update({ status: "completed" }).eq("id", campaignId);
  } else if (statuses.some((s: string) => ["preparing", "uploading", "waiting_for_instagram", "publishing"].includes(s))) {
    await supabase.from("pub_campaigns").update({ status: "running" }).eq("id", campaignId);
  }
}
