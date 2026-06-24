import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { stringify } from "csv-stringify/sync";
import type { ProspectList, OfferTemplate, Prospect } from "./types";

const DATA_DIR = path.join(process.cwd(), "..", "data");
const LISTS_PATH = path.join(DATA_DIR, "outreach-lists.json");
const TEMPLATES_PATH = path.join(DATA_DIR, "outreach-templates.json");
const CSV_DIR = path.join(DATA_DIR, "csv");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// ── Prospect Lists ────────────────────────────────────────────────────────────

export function readProspectLists(): ProspectList[] {
  if (!existsSync(LISTS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LISTS_PATH, "utf-8")) as ProspectList[];
  } catch {
    return [];
  }
}

export function writeProspectLists(lists: ProspectList[]): void {
  ensureDataDir();
  writeFileSync(LISTS_PATH, JSON.stringify(lists, null, 2), "utf-8");
}

export function writeProspectListAsCsv(list: ProspectList): void {
  if (!existsSync(CSV_DIR)) mkdirSync(CSV_DIR, { recursive: true });
  const rows = list.prospects.map((p) => ({
    id: p.id,
    fullName: p.fullName ?? "",
    firstName: p.firstName ?? "",
    headline: p.headline ?? "",
    company: p.company ?? "",
    jobTitle: p.jobTitle ?? "",
    location: p.location ?? "",
    profileUrl: p.profileUrl ?? "",
    email: p.email ?? "",
    bio: p.bio ?? "",
    website: p.website ?? "",
    followers: p.followers ?? "",
    customNotes: p.customNotes ?? "",
    linkedinMessage: p.linkedinMessage ?? "",
    emailMessage: p.emailMessage ?? "",
    draftStatus: p.draftStatus,
    lastDraftedAt: p.lastDraftedAt ?? "",
    // ── Lead Intelligence columns ──
    source: p.source ?? "",
    businessCategory: p.businessCategory ?? "",
    rating: p.rating ?? "",
    reviewCount: p.reviewCount ?? "",
    priceRange: p.priceRange ?? "",
    phone: p.phone ?? "",
    address: p.address ?? "",
    priorityScore: p.priorityScore ?? "",
    priorityLevel: p.priorityLevel ?? "",
    websiteStatus: p.websiteStatus ?? "",
    reviewSummary: p.reviewSummary ?? "",
    outreachAngle: p.outreachAngle ?? "",
    whatsappMessage: p.whatsappMessage ?? "",
    analysisStatus: p.analysisStatus ?? "",
    lastAnalyzedAt: p.lastAnalyzedAt ?? "",
    leadStatus: p.leadStatus ?? "",
    lastContactedAt: p.lastContactedAt ?? "",
    followUpDate: p.followUpDate ?? "",
    dealValue: p.dealValue ?? "",
    priceQuoted: p.priceQuoted ?? "",
    priceConfirmed: p.priceConfirmed ?? "",
  }));
  const safeName = list.name.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
  const csvPath = path.join(CSV_DIR, `${safeName}-${list.id.slice(0, 8)}.csv`);
  writeFileSync(csvPath, stringify(rows, { header: true }), "utf-8");
}

// Seed CRM/analysis defaults on import so every lead has a sane starting state.
export function defaultLeadFields(): Pick<Prospect, "leadStatus" | "analysisStatus"> {
  return { leadStatus: "new", analysisStatus: "idle" };
}

// ── Templates ─────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE: OfferTemplate = {
  id: "default",
  offerName: "Website Design Agency",
  whatYouSell: "website design",
  channelFocus: "LinkedIn",
  valueProps: [
    "conversion-focused design that turns visitors into leads",
    "fast turnaround (2–3 weeks)",
    "built for founders who need credibility fast",
  ],
  tone: "casual-direct",
  cta: "Worth a quick chat?",
  proofPoints: "",
  dosAndDonts: "",
  isActive: true,
  createdAt: new Date().toISOString(),
};

export function readTemplates(): OfferTemplate[] {
  if (!existsSync(TEMPLATES_PATH)) {
    const seed = [{ ...DEFAULT_TEMPLATE, id: uuid() }];
    ensureDataDir();
    writeFileSync(TEMPLATES_PATH, JSON.stringify(seed, null, 2), "utf-8");
    return seed;
  }
  try {
    const parsed = JSON.parse(readFileSync(TEMPLATES_PATH, "utf-8")) as OfferTemplate[];
    if (!parsed.length) {
      const seed = [{ ...DEFAULT_TEMPLATE, id: uuid() }];
      writeFileSync(TEMPLATES_PATH, JSON.stringify(seed, null, 2), "utf-8");
      return seed;
    }
    return parsed;
  } catch {
    // Corrupted file — seed defaults so the app remains usable
    const seed = [{ ...DEFAULT_TEMPLATE, id: uuid() }];
    try {
      ensureDataDir();
      writeFileSync(TEMPLATES_PATH, JSON.stringify(seed, null, 2), "utf-8");
    } catch { /* ignore; DATA_DIR may be read-only */ }
    return seed;
  }
}

export function writeTemplates(templates: OfferTemplate[]): void {
  ensureDataDir();
  writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2), "utf-8");
}

export function getActiveTemplate(): OfferTemplate | undefined {
  return readTemplates().find((t) => t.isActive);
}
