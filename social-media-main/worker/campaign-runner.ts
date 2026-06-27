import { supabase } from "./lib/supabase";
import { computeFirstSlot, computeNextSlot } from "../app/src/lib/services/schedule-service";
import type { ScheduleRule } from "../app/src/lib/db/types";

const WORKER_ID = process.env.WORKER_ID ?? "worker-1";
const BATCH_SIZE = 50;
const LOCK_DURATION_MS = 60_000;
let tickRunning = false;

export async function runCampaignRunnerTick(): Promise<void> {
  if (tickRunning) {
    console.log("[CampaignRunner] Previous tick still running - skipping");
    return;
  }
  tickRunning = true;
  const tickStarted = Date.now();
  try {
    const { data: campaigns } = await supabase
      .from("pub_campaigns")
      .select("id")
      .eq("status", "running");

    if (!campaigns || campaigns.length === 0) return;

    for (const campaign of campaigns) {
      await processCampaign(campaign.id).catch((err) =>
        console.error(`[CampaignRunner] Error processing campaign ${campaign.id}:`, err)
      );
    }
    console.log(`[CampaignRunner] Tick complete in ${Date.now() - tickStarted}ms (${campaigns.length} campaign(s))`);
  } catch (err) {
    console.error("[CampaignRunner] Tick error:", err);
  } finally {
    tickRunning = false;
  }
}

async function releaseLock(campaignId: string): Promise<void> {
  await supabase
    .from("pub_campaign_runner_state")
    .update({ locked_until: null, worker_id: null })
    .eq("campaign_id", campaignId)
    .eq("worker_id", WORKER_ID); // finding #4: only release our own lock
}

async function processCampaign(campaignId: string): Promise<void> {
  const now = new Date();

  const { data: existingState } = await supabase
    .from("pub_campaign_runner_state")
    .select("*")
    .eq("campaign_id", campaignId)
    .single();

  if (
    existingState?.locked_until &&
    new Date(existingState.locked_until) > now &&
    existingState.worker_id !== WORKER_ID
  ) {
    return;
  }

  const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS).toISOString();
  const { error: lockError } = await supabase
    .from("pub_campaign_runner_state")
    .upsert({
      campaign_id: campaignId,
      cursor: existingState?.cursor ?? 0,
      last_tick: now.toISOString(),
      locked_until: lockedUntil,
      worker_id: WORKER_ID,
    });
  if (lockError) return;

  const cursor = existingState?.cursor ?? 0;

  // finding #10: caption_prompt_template removed — not used here
  const { data: campaign } = await supabase
    .from("pub_campaigns")
    .select("schedule_rule")
    .eq("id", campaignId)
    .single();
  if (!campaign) {
    await releaseLock(campaignId);
    return;
  }

  const { data: campaignVideos } = await supabase
    .from("pub_campaign_videos")
    .select("video_id, position")
    .eq("campaign_id", campaignId)
    .eq("skipped", false)
    .gt("position", cursor)
    .order("position", { ascending: true })
    .limit(BATCH_SIZE);

  const { data: campaignAccounts } = await supabase
    .from("pub_campaign_accounts")
    .select("account_id")
    .eq("campaign_id", campaignId);

  if (!campaignVideos || campaignVideos.length === 0) {
    await supabase.from("pub_campaigns").update({ status: "completed" }).eq("id", campaignId);
    await releaseLock(campaignId);
    console.log(`[CampaignRunner] Campaign ${campaignId} completed — all videos scheduled`);
    return;
  }

  const accountIds = (campaignAccounts ?? []).map((a: any) => a.account_id);
  if (accountIds.length === 0) {
    // finding #3: release lock before returning so the campaign isn't stuck for 60s
    await releaseLock(campaignId);
    return;
  }

  const rule: ScheduleRule = campaign.schedule_rule as ScheduleRule;

  const { data: lastJob } = await supabase
    .from("pub_upload_jobs")
    .select("scheduled_at")
    .eq("campaign_id", campaignId)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .single();

  let slotTime = lastJob?.scheduled_at
    ? computeNextSlot(rule, new Date(lastJob.scheduled_at))
    : computeFirstSlot(rule);

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

  if (jobs.length > 0) {
    const { error } = await supabase.from("pub_upload_jobs").insert(jobs);
    // finding #9: check Postgres unique_violation code, not fragile message string
    if (error && error.code !== "23505") {
      throw new Error(`Failed to insert jobs: ${error.message}`);
    }
    console.log(`[CampaignRunner] Campaign ${campaignId}: generated ${jobs.length} jobs, cursor → ${newCursor}`);
  }

  // finding #4: worker_id guard in releaseLock prevents a slow worker from
  // clearing a different worker's freshly acquired lock
  await supabase.from("pub_campaign_runner_state").update({
    cursor: newCursor,
    last_tick: now.toISOString(),
    locked_until: null,
    worker_id: null,
  }).eq("campaign_id", campaignId).eq("worker_id", WORKER_ID);
}
