import type { ClipEdit, Clip, ClipJob } from "@/lib/types";
import {
  readEdit as fileReadEdit,
  writeEdit as fileWriteEdit,
  getDefaultEdit as fileGetDefaultEdit,
} from "@/lib/clip/store";
import { serverClient } from "../client";

export interface ClipEditsRepo {
  get(clipId: string): Promise<ClipEdit | undefined>;
  write(clipId: string, edit: ClipEdit): Promise<void>;
  getDefault(clip: Clip, job: ClipJob): ClipEdit;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileClipEdits: ClipEditsRepo = {
  async get(id) { return fileReadEdit(id); },
  async write(id, edit) { fileWriteEdit(id, edit); },
  getDefault: fileGetDefaultEdit,
};

// ── Supabase backend ─────────────────────────────────────────────────────────

export const supabaseClipEdits: ClipEditsRepo = {
  async get(clipId) {
    const { data, error } = await serverClient()
      .from("clip_edits")
      .select("doc")
      .eq("clip_id", clipId)
      .single();
    if (error || !data) return undefined;
    return (data as Record<string, unknown>).doc as ClipEdit;
  },
  async write(clipId, edit) {
    const { error } = await serverClient().from("clip_edits").upsert({
      clip_id: clipId,
      job_id: edit.jobId,
      doc: edit,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
  // getDefault is pure — no DB needed
  getDefault: fileGetDefaultEdit,
};
