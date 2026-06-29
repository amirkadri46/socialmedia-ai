import type { ClipJob, ClipProgress } from "@/lib/types";
import {
  readJobs,
  writeJobs,
  upsertJob as fileUpsertJob,
  getJob as fileGetJob,
  setLiveProgress as fileSetProgress,
  getLiveProgress as fileGetProgress,
  clearLiveProgress as fileClearProgress,
  requestCancel as fileRequestCancel,
  isCancelRequested as fileIsCancelRequested,
  clearCancel as fileClearCancel,
} from "@/lib/clip/store";
import { serverClient } from "../client";

export interface ClipJobsRepo {
  getAll(): Promise<ClipJob[]>;
  get(jobId: string): Promise<ClipJob | undefined>;
  upsert(job: ClipJob): Promise<void>;
  delete(jobId: string): Promise<void>;
  // Live progress
  setProgress(jobId: string, progress: ClipProgress): Promise<void>;
  getProgress(jobId: string): Promise<ClipProgress | undefined>;
  clearProgress(jobId: string): Promise<void>;
  // Cancellation (always in-memory — fast poll path)
  requestCancel(jobId: string): void;
  isCancelRequested(jobId: string): boolean;
  clearCancel(jobId: string): void;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileClipJobs: ClipJobsRepo = {
  async getAll() { return readJobs(); },
  async get(id) { return fileGetJob(id); },
  async upsert(job) { fileUpsertJob(job); },
  async delete(id) { writeJobs(readJobs().filter((j) => j.id !== id)); },
  async setProgress(id, p) { fileSetProgress(id, p); },
  async getProgress(id) { return fileGetProgress(id); },
  async clearProgress(id) { fileClearProgress(id); },
  requestCancel: fileRequestCancel,
  isCancelRequested: fileIsCancelRequested,
  clearCancel: fileClearCancel,
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): ClipJob {
  return {
    id: r.id as string,
    sourceUrl: r.source_url as string | undefined,
    sourceTitle: (r.source_title as string) ?? "",
    sourceDurationSec: r.source_duration_sec as number,
    sourceThumbnail: r.source_thumbnail as string | undefined,
    status: r.status as ClipJob["status"],
    clipModel: (r.clip_model as string) ?? "Auto",
    genre: (r.genre as string) ?? "Auto",
    clipLengthMode: (r.clip_length_mode as string) ?? "Auto (0-3m)",
    autoHook: r.auto_hook as boolean,
    captionPreset: (r.caption_preset as string) ?? "Karaoke",
    aspectRatio: (r.aspect_ratio as string) ?? "9:16",
    speechLanguage: (r.speech_language as string) ?? "English",
    includeMomentsPrompt: r.include_moments_prompt as string | undefined,
    rangeStartSec: r.range_start_sec as number,
    rangeEndSec: r.range_end_sec as number,
    topK: r.top_k as number,
    errors: (r.errors as string[]) ?? [],
    createdAt: r.created_at as string,
  };
}

function toRow(j: ClipJob) {
  return {
    id: j.id,
    source_url: j.sourceUrl ?? null,
    source_title: j.sourceTitle,
    source_duration_sec: j.sourceDurationSec,
    source_thumbnail: j.sourceThumbnail ?? null,
    status: j.status,
    clip_model: j.clipModel,
    genre: j.genre,
    clip_length_mode: j.clipLengthMode,
    auto_hook: j.autoHook,
    caption_preset: j.captionPreset,
    aspect_ratio: j.aspectRatio,
    speech_language: j.speechLanguage,
    include_moments_prompt: j.includeMomentsPrompt ?? null,
    range_start_sec: j.rangeStartSec,
    range_end_sec: j.rangeEndSec,
    top_k: j.topK,
    errors: j.errors,
    created_at: j.createdAt,
  };
}

export const supabaseClipJobs: ClipJobsRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("clip_jobs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async get(id) {
    const { data, error } = await serverClient()
      .from("clip_jobs")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return undefined;
    return fromRow(data as Record<string, unknown>);
  },
  async upsert(job) {
    const { error } = await serverClient().from("clip_jobs").upsert(toRow(job));
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient().from("clip_jobs").delete().eq("id", id);
    if (error) throw error;
  },
  async setProgress(jobId, progress) {
    // ponytail: only persist status transitions, not every pct-tick — the SSE stream carries
    // fine-grained progress; the DB only needs to reflect the coarse status for polling.
    const { error } = await serverClient()
      .from("clip_jobs")
      .update({ status: progress.status })
      .eq("id", jobId);
    if (error) throw error;
  },
  async getProgress(jobId) {
    const { data, error } = await serverClient()
      .from("clip_jobs")
      .select("progress")
      .eq("id", jobId)
      .single();
    if (error || !data) return undefined;
    return (data as Record<string, unknown>).progress as ClipProgress | undefined;
  },
  async clearProgress(jobId) {
    await serverClient().from("clip_jobs").update({ progress: null }).eq("id", jobId);
  },
  // ponytail: delegate to store.ts so the pipeline's isCancelRequested/clearCancel calls hit the same Set
  requestCancel: fileRequestCancel,
  isCancelRequested: fileIsCancelRequested,
  clearCancel: fileClearCancel,
};
