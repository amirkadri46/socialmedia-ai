import type { Clip } from "@/lib/types";
import {
  readClips,
  writeClips,
  appendClips,
  clipsForJob as fileClipsForJob,
  getClip as fileGetClip,
  updateClip as fileUpdateClip,
} from "@/lib/clip/store";
import { serverClient } from "../client";

export interface ClipsRepo {
  getAll(): Promise<Clip[]>;
  forJob(jobId: string): Promise<Clip[]>;
  get(clipId: string): Promise<Clip | undefined>;
  append(clips: Clip[]): Promise<void>;
  update(clipId: string, patch: Partial<Clip>): Promise<Clip | undefined>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileClips: ClipsRepo = {
  async getAll() { return readClips(); },
  async forJob(jobId) { return fileClipsForJob(jobId); },
  async get(id) { return fileGetClip(id); },
  async append(clips) { appendClips(clips); },
  async update(id, patch) { return fileUpdateClip(id, patch); },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): Clip {
  return {
    id: r.id as string,
    jobId: r.job_id as string,
    rank: r.rank as number,
    title: r.title as string,
    start: r.start_sec as number,
    end: r.end_sec as number,
    durationSec: r.duration_sec as number,
    score: r.score as number,
    hook: r.hook as string,
    hookType: r.hook_type as string,
    genre: r.genre as string,
    reason: r.reason as string,
    transcript: r.transcript as string,
    filePath: r.file_path as string,
    publicUrl: r.public_url as string | undefined,
    thumbnail: r.thumbnail as string,
    caption: r.caption as string | undefined,
    starred: r.starred as boolean,
    createdAt: r.created_at as string,
  };
}

function toRow(c: Clip) {
  return {
    id: c.id,
    job_id: c.jobId,
    rank: c.rank,
    title: c.title,
    start_sec: c.start,
    end_sec: c.end,
    duration_sec: c.durationSec,
    score: c.score,
    hook: c.hook,
    hook_type: c.hookType,
    genre: c.genre,
    reason: c.reason,
    transcript: c.transcript,
    file_path: c.filePath,
    public_url: c.publicUrl ?? null,
    thumbnail: c.thumbnail,
    caption: c.caption ?? null,
    starred: c.starred,
    created_at: c.createdAt,
  };
}

export const supabaseClips: ClipsRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("clips")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async forJob(jobId) {
    const { data, error } = await serverClient()
      .from("clips")
      .select("*")
      .eq("job_id", jobId)
      .order("score", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async get(clipId) {
    const { data, error } = await serverClient()
      .from("clips")
      .select("*")
      .eq("id", clipId)
      .single();
    if (error) return undefined;
    return fromRow(data as Record<string, unknown>);
  },
  async append(clips) {
    if (!clips.length) return;
    const { error } = await serverClient().from("clips").upsert(clips.map(toRow));
    if (error) throw error;
  },
  async update(clipId, patch) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.starred !== undefined) dbPatch.starred = patch.starred;
    if (patch.filePath !== undefined) dbPatch.file_path = patch.filePath;
    if (patch.publicUrl !== undefined) dbPatch.public_url = patch.publicUrl;
    if (patch.caption !== undefined) dbPatch.caption = patch.caption;
    if (patch.thumbnail !== undefined) dbPatch.thumbnail = patch.thumbnail;
    if (patch.rank !== undefined) dbPatch.rank = patch.rank;
    if (patch.score !== undefined) dbPatch.score = patch.score;
    if (patch.hook !== undefined) dbPatch.hook = patch.hook;
    if (patch.hookType !== undefined) dbPatch.hook_type = patch.hookType;
    if (patch.genre !== undefined) dbPatch.genre = patch.genre;
    if (patch.reason !== undefined) dbPatch.reason = patch.reason;
    if (patch.transcript !== undefined) dbPatch.transcript = patch.transcript;
    if (patch.start !== undefined) dbPatch.start_sec = patch.start;
    if (patch.end !== undefined) dbPatch.end_sec = patch.end;
    if (patch.durationSec !== undefined) dbPatch.duration_sec = patch.durationSec;
    const { data, error } = await serverClient()
      .from("clips")
      .update(dbPatch)
      .eq("id", clipId)
      .select("*")
      .single();
    if (error) return undefined;
    return fromRow(data as Record<string, unknown>);
  },
};
