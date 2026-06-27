import type { Video } from "@/lib/types";
import { readVideos, writeVideos, appendVideo } from "@/lib/csv";
import { serverClient } from "../client";

export interface VideosRepo {
  getAll(): Promise<Video[]>;
  append(video: Video): Promise<void>;
  appendBatch(videos: Video[]): Promise<void>;
  update(id: string, patch: Partial<Video>): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileVideos: VideosRepo = {
  async getAll() { return readVideos(); },
  async append(video) { appendVideo(video); },
  async appendBatch(videos) {
    if (!videos.length) return;
    writeVideos([...readVideos(), ...videos]);
  },
  async update(id, patch) {
    const all = readVideos();
    const idx = all.findIndex((v) => v.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...patch }; writeVideos(all); }
  },
  async delete(id) {
    writeVideos(readVideos().filter((v) => v.id !== id));
  },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): Video {
  return {
    id: r.id as string,
    link: r.link as string,
    thumbnail: r.thumbnail as string,
    creator: r.creator as string,
    views: r.views as number,
    likes: r.likes as number,
    comments: r.comments as number,
    analysis: r.analysis as string,
    newConcepts: r.new_concepts as string,
    datePosted: r.date_posted as string,
    dateAdded: r.date_added as string,
    configName: r.config_name as string,
    starred: r.starred as boolean,
  };
}

function toRow(v: Video) {
  return {
    id: v.id,
    link: v.link,
    thumbnail: v.thumbnail,
    creator: v.creator,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    analysis: v.analysis,
    new_concepts: v.newConcepts,
    date_posted: v.datePosted,
    date_added: v.dateAdded || new Date().toISOString(),
    config_name: v.configName,
    starred: v.starred,
  };
}

export const supabaseVideos: VideosRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("videos")
      .select("*")
      .order("date_added", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async append(video) {
    const { error } = await serverClient().from("videos").upsert(toRow(video));
    if (error) throw error;
  },
  async appendBatch(videos) {
    if (!videos.length) return;
    const { error } = await serverClient().from("videos").upsert(videos.map(toRow));
    if (error) throw error;
  },
  async update(id, patch) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.starred !== undefined) dbPatch.starred = patch.starred;
    if (patch.analysis !== undefined) dbPatch.analysis = patch.analysis;
    if (patch.newConcepts !== undefined) dbPatch.new_concepts = patch.newConcepts;
    if (patch.thumbnail !== undefined) dbPatch.thumbnail = patch.thumbnail;
    const { error } = await serverClient().from("videos").update(dbPatch).eq("id", id);
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient().from("videos").delete().eq("id", id);
    if (error) throw error;
  },
};
