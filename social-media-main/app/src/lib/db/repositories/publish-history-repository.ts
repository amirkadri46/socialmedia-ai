import { supabaseServer } from "@/lib/supabase";
import type { PublishHistory } from "@/lib/db/types";

export const publishHistoryRepository = {
  async insert(data: Omit<PublishHistory, "id">): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_publish_history")
      .insert(data);
    if (error) throw new Error(`publishHistoryRepository.insert: ${error.message}`);
  },

  async findByAccount(accountId: string, since: Date): Promise<PublishHistory[]> {
    const { data, error } = await supabaseServer
      .from("pub_publish_history")
      .select("*")
      .eq("account_id", accountId)
      .gte("published_at", since.toISOString())
      .order("published_at", { ascending: false });
    if (error) throw new Error(`publishHistoryRepository.findByAccount: ${error.message}`);
    return data ?? [];
  },

  async countTodayByAccount(accountId: string): Promise<number> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const { count, error } = await supabaseServer
      .from("pub_publish_history")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("published_at", startOfToday.toISOString());
    if (error) throw new Error(`publishHistoryRepository.countTodayByAccount: ${error.message}`);
    return count ?? 0;
  },

  async findAll(filters: { accountId?: string; since?: string; until?: string; limit?: number } = {}): Promise<PublishHistory[]> {
    let q = supabaseServer
      .from("pub_publish_history")
      .select("*")
      .order("published_at", { ascending: false });
    if (filters.accountId) q = q.eq("account_id", filters.accountId);
    if (filters.since) q = q.gte("published_at", filters.since);
    if (filters.until) q = q.lte("published_at", filters.until);
    if (filters.limit) q = q.limit(filters.limit);
    const { data, error } = await q;
    if (error) throw new Error(`publishHistoryRepository.findAll: ${error.message}`);
    return data ?? [];
  },

  async findPendingAnalytics(limit: number): Promise<PublishHistory[]> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseServer
      .from("pub_publish_history")
      .select("*")
      .is("analytics_fetched_at", null)
      .lt("published_at", oneHourAgo)
      .limit(limit);
    if (error) throw new Error(`publishHistoryRepository.findPendingAnalytics: ${error.message}`);
    return data ?? [];
  },

  async updateAnalytics(
    id: string,
    metrics: { views_count: number; likes_count: number; comments_count: number; reach: number }
  ): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_publish_history")
      .update({ ...metrics, analytics_fetched_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`publishHistoryRepository.updateAnalytics: ${error.message}`);
  },

  async findWithFilters(filters: {
    account_id?: string;
    video_id?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: any[]; total: number }> {
    let query = supabaseServer
      .from("pub_publish_history")
      .select(
        `*, pub_videos(title, thumbnail_object_id), pub_instagram_accounts(username)`,
        { count: "exact" }
      )
      .order("published_at", { ascending: false });

    if (filters.account_id) query = query.eq("account_id", filters.account_id);
    if (filters.video_id) query = query.eq("video_id", filters.video_id);
    if (filters.from) query = query.gte("published_at", filters.from);
    if (filters.to) query = query.lte("published_at", filters.to);
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw new Error(`publishHistoryRepository.findWithFilters: ${error.message}`);

    return {
      rows: (data ?? []).map((row: any) => ({
        ...row,
        video_title: row.pub_videos?.title ?? "",
        video_thumbnail_key: row.pub_videos?.thumbnail_object_id ?? null,
        account_username: row.pub_instagram_accounts?.username ?? "",
      })),
      total: count ?? 0,
    };
  },
};
