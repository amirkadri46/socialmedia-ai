import { NextResponse } from "next/server";
import { rmSync, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { repos } from "@/lib/db";
import { writeProspectListAsCsv, defaultLeadFields } from "@/lib/outreach";
import type { Prospect, ProspectList } from "@/lib/types";

const CSV_DIR = path.join(process.cwd(), "..", "data", "csv");

// Fields callers are allowed to update on a prospect via PATCH
const WRITABLE_PROSPECT_FIELDS = new Set<string>([
  "fullName", "firstName", "headline", "company", "jobTitle", "location",
  "profileUrl", "email", "bio", "website", "followers", "customNotes",
  "linkedinMessage", "emailMessage", "draftStatus", "lastDraftedAt",
  "businessCategory", "rating", "reviewCount", "priceRange", "phone", "address", "reviewsRaw",
  "analysisStatus", "priorityScore", "priorityLevel", "reviewSummary", "websiteStatus",
  "outreachAngle", "lastAnalyzedAt", "whatsappMessage", "coldCallNotes",
  "leadStatus", "lastContactedAt", "followUpDate", "dealValue",
  "priceQuoted", "priceConfirmed",
]);

const MAPS_FIELDS = ["businessCategory", "rating", "reviewCount", "priceRange", "address", "reviewsRaw"];

export async function GET() {
  const lists = await repos.prospects.getLists();
  return NextResponse.json(lists.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt,
    count: l.prospects.length,
  })));
}

export async function POST(req: Request) {
  const { listName, rows, mapping, csvText, detectedSource } = (await req.json()) as {
    listName: string;
    rows: Record<string, string>[];
    mapping: Record<string, string>;
    csvText?: string;
    detectedSource?: "csv" | "maps";
  };

  const mappedFields = new Set(Object.values(mapping));
  const isMaps = detectedSource === "maps" || MAPS_FIELDS.some((f) => mappedFields.has(f));

  const num = (v: unknown): number | undefined => {
    if (v == null || v === "") return undefined;
    const n = Number(String(v).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };

  const prospects: Prospect[] = rows.map((row) => {
    const mapped: Record<string, string | number> = {};
    const rawData: Record<string, string> = {};
    for (const [csvCol, value] of Object.entries(row)) {
      const field = mapping[csvCol];
      if (!field || field === "skip") rawData[csvCol] = value;
      else if (field === "rawData") rawData[csvCol] = value;
      else mapped[field] = value;
    }
    return {
      id: uuid(),
      fullName: mapped.fullName as string | undefined,
      firstName: mapped.firstName as string | undefined,
      headline: mapped.headline as string | undefined,
      company: mapped.company as string | undefined,
      jobTitle: mapped.jobTitle as string | undefined,
      location: mapped.location as string | undefined,
      profileUrl: mapped.profileUrl as string | undefined,
      email: mapped.email as string | undefined,
      bio: mapped.bio as string | undefined,
      website: mapped.website as string | undefined,
      followers: num(mapped.followers),
      customNotes: "",
      draftStatus: "idle",
      source: isMaps ? "maps" : "csv",
      rawData: Object.keys(rawData).length ? rawData : undefined,
      businessCategory: mapped.businessCategory as string | undefined,
      rating: num(mapped.rating),
      reviewCount: num(mapped.reviewCount),
      priceRange: mapped.priceRange as string | undefined,
      phone: mapped.phone as string | undefined,
      address: mapped.address as string | undefined,
      reviewsRaw: mapped.reviewsRaw as string | undefined,
      ...defaultLeadFields(),
    };
  });

  const newList: ProspectList = {
    id: uuid(),
    name: listName || "Untitled List",
    createdAt: new Date().toISOString(),
    prospects,
  };

  await repos.prospects.upsertList(newList);
  // Keep CSV export for file backend convenience
  try { writeProspectListAsCsv(newList); } catch { /* ok if data dir doesn't exist */ }

  if (csvText) {
    const safeName = (listName || "list").replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
    try {
      if (!existsSync(CSV_DIR)) mkdirSync(CSV_DIR, { recursive: true });
      writeFileSync(path.join(CSV_DIR, `${safeName}-${newList.id.slice(0, 8)}-original.csv`), csvText, "utf-8");
    } catch { /* ignore if data dir not writable */ }
  }

  return NextResponse.json(newList, { status: 201 });
}

export async function PATCH(req: Request) {
  const { listId, prospectId, updates } = (await req.json()) as {
    listId: string;
    prospectId: string;
    updates: Partial<Prospect>;
  };

  const list = await repos.prospects.getList(listId);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const prospect = list.prospects.find((p) => p.id === prospectId);
  if (!prospect) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });

  const safeUpdates: Partial<Prospect> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (WRITABLE_PROSPECT_FIELDS.has(k)) (safeUpdates as Record<string, unknown>)[k] = v;
  }
  if (
    safeUpdates.leadStatus === "contacted" &&
    !prospect.lastContactedAt &&
    !safeUpdates.lastContactedAt
  ) {
    safeUpdates.lastContactedAt = new Date().toISOString();
  }

  const updated = { ...prospect, ...safeUpdates };
  await repos.prospects.upsertProspect(listId, updated);
  // Skip full-CSV rebuild on single-field updates — the CSV is a convenience export
  // only and rebuilding it on every PATCH is O(n) per update (quadratic for bulk ops).
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const listId = searchParams.get("listId");
  const prospectId = searchParams.get("prospectId");

  if (listId && prospectId) {
    const list = await repos.prospects.getList(listId);
    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });
    const exists = list.prospects.some((p) => p.id === prospectId);
    if (!exists) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    await repos.prospects.deleteProspect(listId, prospectId);
    return NextResponse.json({ ok: true });
  }

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const lists = await repos.prospects.getLists();
  const target = lists.find((l) => l.id === id);
  if (!target) return NextResponse.json({ error: "List not found" }, { status: 404 });

  // Delete from the JSON store first (source of truth) so a CSV-cleanup failure
  // can never leave the list present in JSON with its CSV already gone.
  await repos.prospects.deleteList(id);

  // Best-effort CSV cleanup (file backend only; no-op if not present).
  try {
    if (existsSync(CSV_DIR)) {
      const shortId = id.slice(0, 8);
      const safeName = target.name.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
      for (const suffix of ["", "-original"]) {
        const csvFile = path.join(CSV_DIR, `${safeName}-${shortId}${suffix}.csv`);
        if (existsSync(csvFile)) rmSync(csvFile);
      }
    }
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
