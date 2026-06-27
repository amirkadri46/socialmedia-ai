import type { Word } from "@/lib/types";
import { readTranscript as fileReadTranscript, writeTranscript as fileWriteTranscript } from "@/lib/clip/store";
import { serverClient } from "../client";

export interface ClipTranscriptsRepo {
  get(jobId: string): Promise<Word[]>;
  write(jobId: string, words: Word[]): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileClipTranscripts: ClipTranscriptsRepo = {
  async get(jobId) { return fileReadTranscript(jobId); },
  async write(jobId, words) { fileWriteTranscript(jobId, words); },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

export const supabaseClipTranscripts: ClipTranscriptsRepo = {
  async get(jobId) {
    const { data, error } = await serverClient()
      .from("clip_transcripts")
      .select("words")
      .eq("job_id", jobId)
      .single();
    if (error || !data) return [];
    return ((data as Record<string, unknown>).words as Word[]) ?? [];
  },
  async write(jobId, words) {
    const { error } = await serverClient().from("clip_transcripts").upsert({
      job_id: jobId,
      words,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
};
