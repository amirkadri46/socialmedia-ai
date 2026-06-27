import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { repos } from "@/lib/db";
import type { OfferTemplate } from "@/lib/types";

export async function GET() {
  return NextResponse.json(await repos.offerTemplates.getAll());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Omit<OfferTemplate, "id" | "createdAt">;
  const templates = await repos.offerTemplates.getAll();

  // If this is the first template or marked active, deactivate others
  if (body.isActive || templates.length === 0) {
    await Promise.all(templates.filter((t) => t.isActive).map((t) =>
      repos.offerTemplates.upsert({ ...t, isActive: false })
    ));
  }

  const newTemplate: OfferTemplate = {
    ...body,
    id: uuid(),
    createdAt: new Date().toISOString(),
    isActive: body.isActive ?? templates.length === 0,
  };
  await repos.offerTemplates.upsert(newTemplate);
  return NextResponse.json(newTemplate, { status: 201 });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as OfferTemplate;
  const templates = await repos.offerTemplates.getAll();
  const existing = templates.find((t) => t.id === body.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If setting active, deactivate others first
  if (body.isActive) {
    await Promise.all(
      templates.filter((t) => t.id !== body.id && t.isActive).map((t) =>
        repos.offerTemplates.upsert({ ...t, isActive: false })
      )
    );
  }
  const updated = { ...existing, ...body };
  await repos.offerTemplates.upsert(updated);
  return NextResponse.json(updated);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const templates = await repos.offerTemplates.getAll();
  const target = templates.find((t) => t.id === id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await repos.offerTemplates.delete(id);

  // If deleted template was active, activate the first remaining one
  const remaining = templates.filter((t) => t.id !== id);
  if (target.isActive && remaining.length > 0) {
    await repos.offerTemplates.upsert({ ...remaining[0], isActive: true });
  }

  return NextResponse.json({ ok: true });
}
