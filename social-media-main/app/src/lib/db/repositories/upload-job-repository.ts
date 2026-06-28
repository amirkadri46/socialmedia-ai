import { supabaseServer } from "@/lib/supabase";
import type { JobStatus, UploadJob } from "@/lib/db/types";

export interface UploadJobWithMeta extends UploadJob {
  campaign_name: string;
  video_title: string;
  account_username: string;
}

type UploadJobJoinedRow = UploadJob & {
  pub_campaigns?: { name?: string | null } | null;
  pub_videos?: { title?: string | null } | null;
  pub_instagram_accounts?: { username?: string | null } | null;
};

export const uploadJobRepository = {
  async findDue(limit: number): Promise<UploadJob[]> {
    const { data, error } = await supabaseServer
      .from("pub_upload_jobs")
      .select("*")
      .eq("status", "queued")
      .lte("scheduled_at", new Date().toISOString())
      .is("claimed_by", null)
      .order("scheduled_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`uploadJobRepository.findDue: ${error.message}`);
    return data ?? [];
  },

  async claim(jobId: string, workerId: string): Promise<boolean> {
    const { data, error } = await supabaseServer
      .from("pub_upload_jobs")
      .update({ claimed_by: workerId, claimed_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "queued")
      .is("claimed_by", null)
      .select("id");
    if (error) throw new Error(`uploadJobRepository.claim: ${error.message}`);
    return (data ?? []).length > 0;
  },

  async updateStatus(jobId: string, status: JobStatus, extra: Partial<UploadJob> = {}): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_upload_jobs")
      .update({ status, ...extra })
      .eq("id", jobId);
    if (error) throw new Error(`uploadJobRepository.updateStatus: ${error.message}`);
  },

  async create(data: Omit<UploadJob, "id" | "created_at">): Promise<UploadJob> {
    const { data: row, error } = await supabaseServer
      .from("pub_upload_jobs")
      .insert(data)
      .select()
      .single();
    if (error) throw new Error(`uploadJobRepository.create: ${error.message}`);
    return row;
  },

  async createMany(data: Omit<UploadJob, "id" | "created_at">[]): Promise<void> {
    if (data.length === 0) return;
    const { error } = await supabaseServer
      .from("pub_upload_jobs")
      .upsert(data, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) throw new Error(`uploadJobRepository.createMany: ${error.message}`);
  },

  async findByCampaign(campaignId: string, statusFilter?: JobStatus[]): Promise<UploadJob[]> {
    let q = supabaseServer
      .from("pub_upload_jobs")
      .select("*")
      .eq("campaign_id", campaignId);
    if (statusFilter && statusFilter.length > 0) q = q.in("status", statusFilter);
    const { data, error } = await q;
    if (error) throw new Error(`uploadJobRepository.findByCampaign: ${error.message}`);
    return data ?? [];
  },

  async findById(id: string): Promise<UploadJob | null> {
    const { data } = await supabaseServer
      .from("pub_upload_jobs")
      .select("*")
      .eq("id", id)
      .single();
    return data ?? null;
  },

  async cancel(jobId: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_upload_jobs")
      .update({ status: "cancelled" })
      .eq("id", jobId)
      .neq("status", "published");
    if (error) throw new Error(`uploadJobRepository.cancel: ${error.message}`);
  },

  async resetFailed(jobId: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_upload_jobs")
      .update({ status: "queued", error_message: null, retry_count: 0, claimed_by: null, claimed_at: null })
      .eq("id", jobId);
    if (error) throw new Error(`uploadJobRepository.resetFailed: ${error.message}`);
  },

  async findWithFilters(filters: {
    campaign_id?: string;
    account_id?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: UploadJobWithMeta[]; total: number }> {
    let query = supabaseServer
      .from("pub_upload_jobs")
      .select(
        `*, pub_campaigns(name), pub_videos(title), pub_instagram_accounts(username)`,
        { count: "exact" }
      )
      .order("scheduled_at", { ascending: true });

    if (filters.campaign_id) query = query.eq("campaign_id", filters.campaign_id);
    if (filters.account_id) query = query.eq("account_id", filters.account_id);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.from) query = query.gte("scheduled_at", filters.from);
    if (filters.to) query = query.lte("scheduled_at", filters.to);
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`uploadJobRepository.findWithFilters: ${error.message}`);

    return {
      rows: ((data ?? []) as UploadJobJoinedRow[]).map((row) => ({
        ...row,
        campaign_name: row.pub_campaigns?.name ?? "",
        video_title: row.pub_videos?.title ?? "",
        account_username: row.pub_instagram_accounts?.username ?? "",
      })),
      total: count ?? 0,
    };
  },
};
