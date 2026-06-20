import { NextResponse } from "next/server";
import { rmSync, existsSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { readProspectLists, writeProspectLists, writeProspectListAsCsv } from "@/lib/outreach";
import type { Prospect, ProspectList } from "@/lib/types";

const CSV_DIR = path.join(process.cwd(), "..", "data", "csv");

// Fields callers are allowed to update on a prospect via PATCH
const WRITABLE_PROSPECT_FIELDS = new Set<string>([
  "fullName", "firstName", "headline", "company", "jobTitle", "location",
  "profileUrl", "email", "bio", "website", "followers", "customNotes",
  "linkedinMessage", "emailMessage", "draftStatus", "lastDraftedAt",
]);

// GET /api/outreach/lists — return all lists (with prospect count, not full data for perf)
export async function GET() {
  const lists = readProspectLists();
  return NextResponse.json(
    lists.map((l) => ({
      id: l.id,
      name: l.name,
      createdAt: l.createdAt,
      count: l.prospects.length,
    }))
  );
}

// POST /api/outreach/lists — create list from CSV import result
// Body: { listName, rows, mapping, csvText? }
export async function POST(req: Request) {
  const { listName, rows, mapping, csvText } = (await req.json()) as {
    listName: string;
    rows: Record<string, string>[];
    mapping: Record<string, string>;
    csvText?: string;
  };

  const prospects: Prospect[] = rows.map((row) => {
    const mapped: Record<string, string | number> = {};
    const rawData: Record<string, string> = {};

    for (const [csvCol, value] of Object.entries(row)) {
      const field = mapping[csvCol];
      if (!field || field === "skip") {
        rawData[csvCol] = value;
      } else if (field === "rawData") {
        rawData[csvCol] = value;
      } else {
        mapped[field] = value;
      }
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
      followers: mapped.followers ? Number(mapped.followers) : undefined,
      customNotes: "",
      draftStatus: "idle",
      source: "csv",
      rawData: Object.keys(rawData).length ? rawData : undefined,
    };
  });

  const newList: ProspectList = {
    id: uuid(),
    name: listName || "Untitled List",
    createdAt: new Date().toISOString(),
    prospects,
  };

  const lists = readProspectLists();
  lists.push(newList);
  writeProspectLists(lists);
  writeProspectListAsCsv(newList);

  // Also save the original raw CSV if provided
  if (csvText) {
    const safeName = (listName || "list").replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
    const { writeFileSync, mkdirSync, existsSync } = await import("fs");
    if (!existsSync(CSV_DIR)) mkdirSync(CSV_DIR, { recursive: true });
    writeFileSync(path.join(CSV_DIR, `${safeName}-${newList.id.slice(0, 8)}-original.csv`), csvText, "utf-8");
  }

  return NextResponse.json(newList, { status: 201 });
}

// PATCH /api/outreach/lists — update a prospect within a list
// Body: { listId, prospectId, updates }
export async function PATCH(req: Request) {
  const { listId, prospectId, updates } = (await req.json()) as {
    listId: string;
    prospectId: string;
    updates: Partial<Prospect>;
  };

  const lists = readProspectLists();
  const list = lists.find((l) => l.id === listId);
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const prospect = list.prospects.find((p) => p.id === prospectId);
  if (!prospect) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });

  // Only apply fields that callers are permitted to write — prevent overwriting id, source, rawData
  const safeUpdates: Partial<Prospect> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (WRITABLE_PROSPECT_FIELDS.has(k)) (safeUpdates as Record<string, unknown>)[k] = v;
  }
  Object.assign(prospect, safeUpdates);
  writeProspectLists(lists);
  writeProspectListAsCsv(list);

  return NextResponse.json(prospect);
}

// DELETE /api/outreach/lists?id= — delete a list
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const lists = readProspectLists();
  const target = lists.find((l) => l.id === id);
  const filtered = lists.filter((l) => l.id !== id);
  if (filtered.length === lists.length) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  // Delete CSV files FIRST so that a crash after this point doesn't leave orphan files
  // with no way to reconstruct the filenames (the list entry would already be gone from JSON)
  if (target && existsSync(CSV_DIR)) {
    const shortId = id.slice(0, 8);
    const safeName = target.name.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
    for (const suffix of ["", "-original"]) {
      const csvFile = path.join(CSV_DIR, `${safeName}-${shortId}${suffix}.csv`);
      if (existsSync(csvFile)) rmSync(csvFile);
    }
  }

  writeProspectLists(filtered);

  return NextResponse.json({ ok: true });
}
