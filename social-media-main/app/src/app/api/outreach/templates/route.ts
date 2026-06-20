import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { readTemplates, writeTemplates } from "@/lib/outreach";
import type { OfferTemplate } from "@/lib/types";

export async function GET() {
  return NextResponse.json(readTemplates());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Omit<OfferTemplate, "id" | "createdAt">;
  const templates = readTemplates();

  // If this is the first template or marked active, deactivate others
  if (body.isActive || templates.length === 0) {
    templates.forEach((t) => (t.isActive = false));
  }

  const newTemplate: OfferTemplate = {
    ...body,
    id: uuid(),
    createdAt: new Date().toISOString(),
    isActive: body.isActive ?? templates.length === 0,
  };

  templates.push(newTemplate);
  writeTemplates(templates);
  return NextResponse.json(newTemplate, { status: 201 });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as OfferTemplate;
  const templates = readTemplates();
  const idx = templates.findIndex((t) => t.id === body.id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If setting active, deactivate others
  if (body.isActive) {
    templates.forEach((t) => (t.isActive = false));
  }
  templates[idx] = { ...templates[idx], ...body };
  writeTemplates(templates);
  return NextResponse.json(templates[idx]);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const templates = readTemplates();
  const filtered = templates.filter((t) => t.id !== id);
  if (filtered.length === templates.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If deleted template was active, activate the first remaining one
  if (!filtered.some((t) => t.isActive) && filtered.length > 0) {
    filtered[0].isActive = true;
  }

  writeTemplates(filtered);
  return NextResponse.json({ ok: true });
}
