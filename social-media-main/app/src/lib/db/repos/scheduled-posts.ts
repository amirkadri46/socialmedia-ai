import type { ScheduledPost } from "@/lib/types";
import {
  readPosts,
  writePosts,
  upsertPost as fileUpsertPost,
} from "@/lib/clip/store";
import { serverClient } from "../client";

export interface ScheduledPostsRepo {
  getAll(): Promise<ScheduledPost[]>;
  upsert(post: ScheduledPost): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileScheduledPosts: ScheduledPostsRepo = {
  async getAll() { return readPosts(); },
  async upsert(post) { fileUpsertPost(post); },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): ScheduledPost {
  return {
    id: r.id as string,
    clipId: r.clip_id as string,
    accountId: r.account_id as string,
    caption: r.caption as string,
    scheduledFor: r.scheduled_for as string | undefined,
    status: r.status as ScheduledPost["status"],
    error: r.error as string | undefined,
    createdAt: r.created_at as string,
  };
}

function toRow(p: ScheduledPost) {
  return {
    id: p.id,
    clip_id: p.clipId,
    account_id: p.accountId,
    caption: p.caption,
    scheduled_for: p.scheduledFor ?? null,
    status: p.status,
    error: p.error ?? null,
    created_at: p.createdAt,
  };
}

export const supabaseScheduledPosts: ScheduledPostsRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("scheduled_posts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async upsert(post) {
    const { error } = await serverClient().from("scheduled_posts").upsert(toRow(post));
    if (error) throw error;
  },
};
