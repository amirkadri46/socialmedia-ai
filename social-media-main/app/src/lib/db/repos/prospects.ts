import type { ProspectList, Prospect } from "@/lib/types";
import { readProspectLists, writeProspectLists } from "@/lib/outreach";
import { serverClient } from "../client";

export interface ProspectsRepo {
  getLists(): Promise<ProspectList[]>;
  getList(id: string): Promise<ProspectList | undefined>;
  upsertList(list: ProspectList): Promise<void>;
  deleteList(id: string): Promise<void>;
  upsertProspect(listId: string, prospect: Prospect): Promise<void>;
  upsertProspects(listId: string, prospects: Prospect[]): Promise<void>;
  deleteProspect(listId: string, prospectId: string): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileProspects: ProspectsRepo = {
  async getLists() { return readProspectLists(); },
  async getList(id) { return readProspectLists().find((l) => l.id === id); },
  async upsertList(list) {
    const all = readProspectLists();
    const idx = all.findIndex((l) => l.id === list.id);
    if (idx >= 0) all[idx] = list; else all.push(list);
    writeProspectLists(all);
  },
  async deleteList(id) {
    writeProspectLists(readProspectLists().filter((l) => l.id !== id));
  },
  async upsertProspect(listId, prospect) {
    return fileProspects.upsertProspects(listId, [prospect]);
  },
  async upsertProspects(listId, prospects) {
    const all = readProspectLists();
    const listIdx = all.findIndex((l) => l.id === listId);
    if (listIdx < 0) return;
    const byId = new Map(prospects.map((p) => [p.id, p]));
    const list = all[listIdx].prospects;
    for (let i = 0; i < list.length; i++) {
      const patch = byId.get(list[i].id);
      if (patch) { byId.delete(list[i].id); list[i] = patch; }
    }
    for (const p of byId.values()) list.push(p);
    writeProspectLists(all);
  },
  async deleteProspect(listId, prospectId) {
    const all = readProspectLists();
    const listIdx = all.findIndex((l) => l.id === listId);
    if (listIdx < 0) return;
    all[listIdx].prospects = all[listIdx].prospects.filter((p) => p.id !== prospectId);
    writeProspectLists(all);
  },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function prospectFromRow(r: Record<string, unknown>): Prospect {
  return {
    id: r.id as string,
    fullName: r.full_name as string | undefined,
    firstName: r.first_name as string | undefined,
    headline: r.headline as string | undefined,
    company: r.company as string | undefined,
    jobTitle: r.job_title as string | undefined,
    location: r.location as string | undefined,
    profileUrl: r.profile_url as string | undefined,
    email: r.email as string | undefined,
    bio: r.bio as string | undefined,
    website: r.website as string | undefined,
    followers: r.followers as number | undefined,
    customNotes: (r.custom_notes as string) ?? "",
    source: (r.source as Prospect["source"]) ?? "csv",
    rawData: r.raw_data as Record<string, string> | undefined,
    businessCategory: r.business_category as string | undefined,
    rating: r.rating as number | undefined,
    reviewCount: r.review_count as number | undefined,
    priceRange: r.price_range as string | undefined,
    phone: r.phone as string | undefined,
    address: r.address as string | undefined,
    reviewsRaw: r.reviews_raw as string | undefined,
    analysisStatus: (r.analysis_status as Prospect["analysisStatus"]) ?? "idle",
    priorityScore: r.priority_score as number | undefined,
    priorityLevel: r.priority_level as Prospect["priorityLevel"] | undefined,
    reviewSummary: r.review_summary as string | undefined,
    websiteStatus: r.website_status as Prospect["websiteStatus"] | undefined,
    outreachAngle: r.outreach_angle as string | undefined,
    lastAnalyzedAt: r.last_analyzed_at as string | undefined,
    draftStatus: (r.draft_status as Prospect["draftStatus"]) ?? "idle",
    lastDraftedAt: r.last_drafted_at as string | undefined,
    linkedinMessage: r.linkedin_message as string | undefined,
    emailMessage: r.email_message as string | undefined,
    whatsappMessage: r.whatsapp_message as string | undefined,
    coldCallNotes: r.cold_call_notes as Prospect["coldCallNotes"] | undefined,
    leadStatus: (r.lead_status as Prospect["leadStatus"]) ?? "new",
    lastContactedAt: r.last_contacted_at as string | undefined,
    followUpDate: r.follow_up_date as string | undefined,
    dealValue: r.deal_value as number | undefined,
    priceQuoted: r.price_quoted as number | undefined,
    priceConfirmed: r.price_confirmed as number | undefined,
  };
}

function prospectToRow(listId: string, p: Prospect) {
  return {
    id: p.id,
    list_id: listId,
    full_name: p.fullName ?? null,
    first_name: p.firstName ?? null,
    headline: p.headline ?? null,
    company: p.company ?? null,
    job_title: p.jobTitle ?? null,
    location: p.location ?? null,
    profile_url: p.profileUrl ?? null,
    email: p.email ?? null,
    bio: p.bio ?? null,
    website: p.website ?? null,
    followers: p.followers ?? null,
    custom_notes: p.customNotes ?? "",
    source: p.source ?? "csv",
    raw_data: p.rawData ?? null,
    business_category: p.businessCategory ?? null,
    rating: p.rating ?? null,
    review_count: p.reviewCount ?? null,
    price_range: p.priceRange ?? null,
    phone: p.phone ?? null,
    address: p.address ?? null,
    reviews_raw: p.reviewsRaw ?? null,
    analysis_status: p.analysisStatus ?? "idle",
    priority_score: p.priorityScore ?? null,
    priority_level: p.priorityLevel ?? null,
    review_summary: p.reviewSummary ?? null,
    website_status: p.websiteStatus ?? null,
    outreach_angle: p.outreachAngle ?? null,
    last_analyzed_at: p.lastAnalyzedAt ?? null,
    draft_status: p.draftStatus ?? "idle",
    last_drafted_at: p.lastDraftedAt ?? null,
    linkedin_message: p.linkedinMessage ?? null,
    email_message: p.emailMessage ?? null,
    whatsapp_message: p.whatsappMessage ?? null,
    cold_call_notes: p.coldCallNotes ?? null,
    lead_status: p.leadStatus ?? "new",
    last_contacted_at: p.lastContactedAt ?? null,
    follow_up_date: p.followUpDate ?? null,
    deal_value: p.dealValue ?? null,
    price_quoted: p.priceQuoted ?? null,
    price_confirmed: p.priceConfirmed ?? null,
  };
}

export const supabaseProspects: ProspectsRepo = {
  async getLists() {
    const { data, error } = await serverClient()
      .from("prospect_lists")
      .select("id, name, created_at, prospects(count)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => {
      const rr = r as Record<string, unknown>;
      const count = ((rr.prospects as { count: number }[] | null) ?? [])[0]?.count ?? 0;
      return {
        id: rr.id as string,
        name: rr.name as string,
        createdAt: rr.created_at as string,
        // ponytail: stub array for count only — getList() loads full prospects
        prospects: Array(count).fill(null) as unknown as Prospect[],
      };
    });
  },

  async getList(id) {
    const db = serverClient();
    const [listRes, prospectsRes] = await Promise.all([
      db.from("prospect_lists").select("*").eq("id", id).single(),
      db.from("prospects").select("*").eq("list_id", id).order("created_at"),
    ]);
    if (listRes.error || !listRes.data) return undefined;
    const r = listRes.data as Record<string, unknown>;
    return {
      id: r.id as string,
      name: r.name as string,
      createdAt: r.created_at as string,
      prospects: ((prospectsRes.data ?? []) as Record<string, unknown>[]).map(prospectFromRow),
    };
  },

  async upsertList(list) {
    const db = serverClient();
    const { error } = await db.from("prospect_lists").upsert({
      id: list.id,
      name: list.name,
      created_at: list.createdAt,
    });
    if (error) throw error;
    // Upsert prospects in batch
    if (list.prospects.length > 0) {
      const rows = list.prospects.map((p) => prospectToRow(list.id, p));
      const { error: pe } = await db.from("prospects").upsert(rows);
      if (pe) throw pe;
    }
  },

  async deleteList(id) {
    // CASCADE deletes prospects automatically
    const { error } = await serverClient().from("prospect_lists").delete().eq("id", id);
    if (error) throw error;
  },

  async upsertProspect(listId, prospect) {
    return supabaseProspects.upsertProspects(listId, [prospect]);
  },
  async upsertProspects(listId, prospects) {
    if (prospects.length === 0) return;
    const { error } = await serverClient()
      .from("prospects")
      .upsert(prospects.map((p) => prospectToRow(listId, p)));
    if (error) throw error;
  },

  async deleteProspect(_listId, prospectId) {
    const { error } = await serverClient().from("prospects").delete().eq("id", prospectId);
    if (error) throw error;
  },
};
