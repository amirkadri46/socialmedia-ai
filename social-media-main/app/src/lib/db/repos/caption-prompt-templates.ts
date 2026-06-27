import type { CaptionPromptTemplate } from "@/lib/types";
import {
  readCaptionPromptTemplates,
  writeCaptionPromptTemplates,
  getCaptionPromptTemplate as fileGet,
  upsertCaptionPromptTemplate as fileUpsert,
  deleteCaptionPromptTemplate as fileDelete,
} from "@/lib/clip/store";
import { serverClient } from "../client";

export interface CaptionPromptTemplatesRepo {
  getAll(): Promise<CaptionPromptTemplate[]>;
  get(id: string): Promise<CaptionPromptTemplate | undefined>;
  upsert(template: CaptionPromptTemplate): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileCaptionPromptTemplates: CaptionPromptTemplatesRepo = {
  async getAll() { return readCaptionPromptTemplates(); },
  async get(id) { return fileGet(id); },
  async upsert(template) { fileUpsert(template); },
  async delete(id) { fileDelete(id); },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): CaptionPromptTemplate {
  return {
    id: r.id as string,
    name: r.name as string,
    creator: r.creator as string | undefined,
    context: r.context as string,
    brandVoice: r.brand_voice as string | undefined,
    cta: r.cta as string | undefined,
    hashtags: r.hashtags as string | undefined,
    includeHashtags: r.include_hashtags as boolean,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toRow(t: CaptionPromptTemplate) {
  return {
    id: t.id,
    name: t.name,
    creator: t.creator ?? null,
    context: t.context,
    brand_voice: t.brandVoice ?? null,
    cta: t.cta ?? null,
    hashtags: t.hashtags ?? null,
    include_hashtags: t.includeHashtags,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export const supabaseCaptionPromptTemplates: CaptionPromptTemplatesRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("caption_prompt_templates")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async get(id) {
    const { data, error } = await serverClient()
      .from("caption_prompt_templates")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return undefined;
    return fromRow(data as Record<string, unknown>);
  },
  async upsert(template) {
    const { error } = await serverClient()
      .from("caption_prompt_templates")
      .upsert(toRow(template));
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient()
      .from("caption_prompt_templates")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },
};
