import type { CaptionTemplate } from "@/lib/types";
import {
  readCaptionTemplates,
  writeCaptionTemplates,
} from "@/lib/clip/store";
import { serverClient } from "../client";

export interface CaptionTemplatesRepo {
  getAll(): Promise<CaptionTemplate[]>;
  upsert(template: CaptionTemplate): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileCaptionTemplates: CaptionTemplatesRepo = {
  async getAll() { return readCaptionTemplates(); },
  async upsert(template) {
    const all = readCaptionTemplates();
    const idx = all.findIndex((t) => t.id === template.id);
    if (idx >= 0) all[idx] = template; else all.push(template);
    writeCaptionTemplates(all);
  },
  async delete(id) {
    writeCaptionTemplates(readCaptionTemplates().filter((t) => t.id !== id));
  },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): CaptionTemplate {
  return {
    id: r.id as string,
    name: r.name as string,
    config: r.config as CaptionTemplate["config"],
    createdAt: r.created_at as string,
  };
}

function toRow(t: CaptionTemplate) {
  return {
    id: t.id,
    name: t.name,
    config: t.config,
    created_at: t.createdAt,
  };
}

export const supabaseCaptionTemplates: CaptionTemplatesRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("caption_templates")
      .select("*")
      .order("created_at");
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async upsert(template) {
    const { error } = await serverClient().from("caption_templates").upsert(toRow(template));
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient().from("caption_templates").delete().eq("id", id);
    if (error) throw error;
  },
};
