import type { OfferTemplate } from "@/lib/types";
import { readTemplates, writeTemplates } from "@/lib/outreach";
import { serverClient } from "../client";

export interface OfferTemplatesRepo {
  getAll(): Promise<OfferTemplate[]>;
  getActive(): Promise<OfferTemplate | undefined>;
  upsert(template: OfferTemplate): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileOfferTemplates: OfferTemplatesRepo = {
  async getAll() { return readTemplates(); },
  async getActive() { return readTemplates().find((t) => t.isActive); },
  async upsert(template) {
    const all = readTemplates();
    const idx = all.findIndex((t) => t.id === template.id);
    if (idx >= 0) all[idx] = template; else all.push(template);
    writeTemplates(all);
  },
  async delete(id) {
    writeTemplates(readTemplates().filter((t) => t.id !== id));
  },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): OfferTemplate {
  return {
    id: r.id as string,
    offerName: r.offer_name as string,
    whatYouSell: r.what_you_sell as string,
    channelFocus: r.channel_focus as OfferTemplate["channelFocus"],
    valueProps: (r.value_props as string[]) ?? [],
    tone: r.tone as string,
    cta: r.cta as string,
    proofPoints: r.proof_points as string | undefined,
    dosAndDonts: r.dos_and_donts as string | undefined,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as string,
  };
}

function toRow(t: OfferTemplate) {
  return {
    id: t.id,
    offer_name: t.offerName,
    what_you_sell: t.whatYouSell,
    channel_focus: t.channelFocus,
    value_props: t.valueProps,
    tone: t.tone,
    cta: t.cta,
    proof_points: t.proofPoints ?? null,
    dos_and_donts: t.dosAndDonts ?? null,
    is_active: t.isActive,
    created_at: t.createdAt,
  };
}

export const supabaseOfferTemplates: OfferTemplatesRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("offer_templates")
      .select("*")
      .order("created_at");
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async getActive() {
    const { data, error } = await serverClient()
      .from("offer_templates")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (error) return undefined;
    return fromRow(data as Record<string, unknown>);
  },
  async upsert(template) {
    const { error } = await serverClient().from("offer_templates").upsert(toRow(template));
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient().from("offer_templates").delete().eq("id", id);
    if (error) throw error;
  },
};
