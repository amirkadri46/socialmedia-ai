import { supabaseServer } from "@/lib/supabase";
import type { Campaign, CampaignRunnerState, CampaignStatus, CampaignVideo } from "@/lib/db/types";

export const campaignRepository = {
  async findAll(): Promise<Campaign[]> {
    const { data, error } = await supabaseServer
      .from("pub_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`campaignRepository.findAll: ${error.message}`);
    return data ?? [];
  },

  async findById(id: string): Promise<Campaign | null> {
    const { data } = await supabaseServer
      .from("pub_campaigns")
      .select("*")
      .eq("id", id)
      .single();
    return data ?? null;
  },

  async findByStatus(status: CampaignStatus): Promise<Campaign[]> {
    const { data, error } = await supabaseServer
      .from("pub_campaigns")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`campaignRepository.findByStatus: ${error.message}`);
    return data ?? [];
  },

  async create(data: Omit<Campaign, "id" | "created_at" | "updated_at">): Promise<Campaign> {
    const { data: row, error } = await supabaseServer
      .from("pub_campaigns")
      .insert(data)
      .select()
      .single();
    if (error) throw new Error(`campaignRepository.create: ${error.message}`);
    return row;
  },

  async update(id: string, data: Partial<Omit<Campaign, "id" | "created_at">>): Promise<Campaign> {
    const { data: row, error } = await supabaseServer
      .from("pub_campaigns")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`campaignRepository.update: ${error.message}`);
    if (!row) throw new Error(`campaignRepository.update: campaign ${id} not found`);
    return row;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_campaigns")
      .delete()
      .eq("id", id);
    if (error) throw new Error(`campaignRepository.delete: ${error.message}`);
  },

  async detachUploadJobs(campaignId: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_upload_jobs")
      .update({ campaign_id: null })
      .eq("campaign_id", campaignId);
    if (error) throw new Error(`campaignRepository.detachUploadJobs: ${error.message}`);
  },

  async getVideos(campaignId: string): Promise<CampaignVideo[]> {
    const { data, error } = await supabaseServer
      .from("pub_campaign_videos")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("position", { ascending: true });
    if (error) throw new Error(`campaignRepository.getVideos: ${error.message}`);
    return data ?? [];
  },

  async addVideo(campaignId: string, videoId: string, position: number): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_campaign_videos")
      .insert({ campaign_id: campaignId, video_id: videoId, position });
    if (error) throw new Error(`campaignRepository.addVideo: ${error.message}`);
  },

  async removeVideo(campaignId: string, videoId: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_campaign_videos")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("video_id", videoId);
    if (error) throw new Error(`campaignRepository.removeVideo: ${error.message}`);
  },

  async reorderVideos(campaignId: string, orderedVideoIds: string[]): Promise<void> {
    const updates = orderedVideoIds.map((videoId, index) =>
      supabaseServer
        .from("pub_campaign_videos")
        .update({ position: index })
        .eq("campaign_id", campaignId)
        .eq("video_id", videoId)
    );
    const results = await Promise.all(updates);
    for (const { error } of results) {
      if (error) throw new Error(`campaignRepository.reorderVideos: ${error.message}`);
    }
  },

  async getAccounts(campaignId: string): Promise<string[]> {
    const { data, error } = await supabaseServer
      .from("pub_campaign_accounts")
      .select("account_id")
      .eq("campaign_id", campaignId);
    if (error) throw new Error(`campaignRepository.getAccounts: ${error.message}`);
    return (data ?? []).map((r: { account_id: string }) => r.account_id);
  },

  async addAccount(campaignId: string, accountId: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_campaign_accounts")
      .upsert({ campaign_id: campaignId, account_id: accountId });
    if (error) throw new Error(`campaignRepository.addAccount: ${error.message}`);
  },

  async removeAccount(campaignId: string, accountId: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_campaign_accounts")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("account_id", accountId);
    if (error) throw new Error(`campaignRepository.removeAccount: ${error.message}`);
  },

  async getRunnerState(campaignId: string): Promise<CampaignRunnerState | null> {
    const { data } = await supabaseServer
      .from("pub_campaign_runner_state")
      .select("*")
      .eq("campaign_id", campaignId)
      .single();
    return data ?? null;
  },

  async upsertRunnerState(state: CampaignRunnerState): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_campaign_runner_state")
      .upsert(state, { onConflict: "campaign_id" });
    if (error) throw new Error(`campaignRepository.upsertRunnerState: ${error.message}`);
  },

  async updateRunnerCursor(campaignId: string, cursor: number): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_campaign_runner_state")
      .update({ cursor, last_tick: new Date().toISOString() })
      .eq("campaign_id", campaignId);
    if (error) throw new Error(`campaignRepository.updateRunnerCursor: ${error.message}`);
  },
};
