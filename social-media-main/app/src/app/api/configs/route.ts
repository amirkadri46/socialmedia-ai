import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { repos } from "@/lib/db";
import type { Config } from "@/lib/types";

export async function GET() {
  const configs = await repos.configs.getAll();
  return NextResponse.json(configs);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.configName || !body.analysisInstruction || !body.newConceptsInstruction) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const newConfig: Config = {
      id: uuid(),
      configName: body.configName,
      creatorsCategory: body.creatorsCategory,
      analysisInstruction: body.analysisInstruction,
      newConceptsInstruction: body.newConceptsInstruction,
    };
    await repos.configs.upsert(newConfig);
    return NextResponse.json(newConfig, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const configs = await repos.configs.getAll();
    const existing = configs.find((c) => c.id === body.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { id, ...rest } = body;
    const updated = { ...existing, ...rest, id: existing.id };
    await repos.configs.upsert(updated);
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await repos.configs.delete(id);
  return NextResponse.json({ success: true });
}
