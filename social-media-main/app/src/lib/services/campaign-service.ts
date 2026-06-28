import { campaignRepository, uploadJobRepository } from "@/lib/db/repositories";
import { calculatePreview, computeFirstSlot, computeNextSlot, type CampaignPreview } from "./schedule-service";
import type { Campaign, ScheduleRule, UploadJob } from "@/lib/db/types";

function buildJobs(
  campaignId: string,
  videoIds: string[],
  accountIds: string[],
  rule: ScheduleRule
): Omit<UploadJob, "id" | "created_at">[] {
  const jobs: Omit<UploadJob, "id" | "created_at">[] = [];
  let slot = computeFirstSlot(rule);

  for (const videoId of videoIds) {
    const jitterMs =
      rule.randomizeMinutes > 0
        ? (Math.random() * 2 - 1) * rule.randomizeMinutes * 60_000
        : 0;
    const scheduled_at = new Date(slot.getTime() + jitterMs).toISOString();

    for (const accountId of accountIds) {
      jobs.push({
        campaign_id: campaignId,
        video_id: videoId,
        account_id: accountId,
        scheduled_at,
        idempotency_key: `${campaignId}-${videoId}-${accountId}`,
        status: "queued",
        retry_count: 0,
        error_message: null,
        claimed_by: null,
        claimed_at: null,
        instagram_container_id: null,
        instagram_media_id: null,
        published_at: null,
      });
    }

    slot = computeNextSlot(rule, slot);
  }

  return jobs;
}

export const campaignService = {
  async listAll(): Promise<Campaign[]> {
    return campaignRepository.findAll();
  },

  async getById(id: string): Promise<Campaign | null> {
    return campaignRepository.findById(id);
  },

  async create(data: {
    name: string;
    captionPromptTemplate?: string;
    scheduleRule: ScheduleRule;
    timezone: string;
    startsAt?: string;
  }): Promise<Campaign> {
    return campaignRepository.create({
      name: data.name,
      status: "draft",
      caption_prompt_template: data.captionPromptTemplate ?? null,
      assignment_mode: "crosspost",
      schedule_rule: data.scheduleRule,
      timezone: data.timezone,
      starts_at: data.startsAt ?? null,
    });
  },

  async update(id: string, data: Partial<Campaign>): Promise<Campaign> {
    return campaignRepository.update(id, data);
  },

  async delete(id: string): Promise<void> {
    await campaignRepository.update(id, { status: "cancelled" });
    await campaignRepository.detachUploadJobs(id);
    await campaignRepository.delete(id);
  },

  async getPreview(id: string): Promise<CampaignPreview> {
    const campaign = await campaignRepository.findById(id);
    if (!campaign) throw new Error("Campaign not found");
    const videos = await campaignRepository.getVideos(id);
    const accountIds = await campaignRepository.getAccounts(id);
    const activeVideos = videos.filter((v) => !v.skipped).length;
    return calculatePreview(activeVideos, accountIds.length, campaign.schedule_rule);
  },

  async publish(id: string): Promise<void> {
    const campaign = await campaignRepository.findById(id);
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.status !== "draft" && campaign.status !== "ready" && campaign.status !== "scheduled") {
      throw new Error(`Campaign is ${campaign.status} - cannot publish`);
    }
    const videos = await campaignRepository.getVideos(id);
    const accountIds = await campaignRepository.getAccounts(id);
    const activeVideos = videos.filter((v) => !v.skipped).sort((a, b) => a.position - b.position);
    if (activeVideos.length === 0) throw new Error("Campaign has no videos");
    if (accountIds.length === 0) throw new Error("Campaign has no accounts");

    const jobs = buildJobs(id, activeVideos.map((v) => v.video_id), accountIds, campaign.schedule_rule);
    await uploadJobRepository.createMany(jobs);
    const firstJobTime = jobs[0] ? Date.parse(jobs[0].scheduled_at) : Date.now();
    await campaignRepository.update(id, { status: firstJobTime > Date.now() ? "scheduled" : "running" });
    await campaignRepository.upsertRunnerState({
      campaign_id: id,
      cursor: activeVideos.at(-1)?.position ?? -1,
      last_tick: null,
      locked_until: null,
      worker_id: null,
    });
  },

  async pause(id: string): Promise<void> {
    await campaignRepository.update(id, { status: "paused" });
  },

  async resume(id: string): Promise<void> {
    await campaignRepository.update(id, { status: "running" });
  },
};
