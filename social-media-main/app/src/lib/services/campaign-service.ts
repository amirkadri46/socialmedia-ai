import { campaignRepository } from "@/lib/db/repositories";
import { calculatePreview, type CampaignPreview } from "./schedule-service";
import type { Campaign, ScheduleRule } from "@/lib/db/types";

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
    if (campaign.status !== "draft" && campaign.status !== "ready") {
      throw new Error(`Campaign is ${campaign.status} — cannot publish`);
    }
    const videos = await campaignRepository.getVideos(id);
    const accountIds = await campaignRepository.getAccounts(id);
    if (videos.length === 0) throw new Error("Campaign has no videos");
    if (accountIds.length === 0) throw new Error("Campaign has no accounts");

    await campaignRepository.update(id, { status: "running" });
    await campaignRepository.upsertRunnerState({
      campaign_id: id,
      cursor: 0,
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
