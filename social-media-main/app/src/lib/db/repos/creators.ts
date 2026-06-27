import type { Creator } from "@/lib/types";
import { readCreators, writeCreators } from "@/lib/csv";
import { serverClient } from "../client";

export interface CreatorsRepo {
  getAll(category?: string): Promise<Creator[]>;
  upsertByUsername(creator: Creator): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileCreators: CreatorsRepo = {
  async getAll(category) {
    const all = readCreators();
    return category ? all.filter((c) => c.category === category) : all;
  },
  async upsertByUsername(creator) {
    const all = readCreators();
    const idx = all.findIndex((c) => c.username === creator.username || c.id === creator.id);
    if (idx >= 0) all[idx] = { ...all[idx], ...creator };
    else all.push(creator);
    writeCreators(all);
  },
  async delete(id) {
    writeCreators(readCreators().filter((c) => c.id !== id));
  },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): Creator {
  return {
    id: r.id as string,
    username: r.username as string,
    category: r.category as string,
    profilePicUrl: r.profile_pic_url as string,
    followers: r.followers as number,
    reelsCount30d: r.reels_count_30d as number,
    avgViews30d: r.avg_views_30d as number,
    lastScrapedAt: r.last_scraped_at ? (r.last_scraped_at as string) : "",
  };
}

function toRow(c: Creator) {
  return {
    id: c.id,
    username: c.username,
    category: c.category,
    profile_pic_url: c.profilePicUrl,
    followers: c.followers,
    reels_count_30d: c.reelsCount30d,
    avg_views_30d: c.avgViews30d,
    last_scraped_at: c.lastScrapedAt || null,
  };
}

export const supabaseCreators: CreatorsRepo = {
  async getAll(category) {
    let q = serverClient().from("creators").select("*").order("username");
    if (category) q = q.eq("category", category);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async upsertByUsername(creator) {
    const { error } = await serverClient()
      .from("creators")
      .upsert(toRow(creator), { onConflict: "username" });
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient().from("creators").delete().eq("id", id);
    if (error) throw error;
  },
};
