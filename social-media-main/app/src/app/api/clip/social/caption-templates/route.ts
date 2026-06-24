import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  readCaptionPromptTemplates,
  upsertCaptionPromptTemplate,
  deleteCaptionPromptTemplate,
  getCaptionPromptTemplate,
} from "@/lib/clip/store";
import type { CaptionPromptTemplate } from "@/lib/types";

// Reusable per-creator caption context templates. Persisted independent of any project,
// so the same template is reusable across creators and clips.

interface TemplateBody {
  id?: string;
  name?: string;
  creator?: string;
  context?: string;
  brandVoice?: string;
  cta?: string;
  hashtags?: string;
  includeHashtags?: boolean;
}

export async function GET() {
  return NextResponse.json(readCaptionPromptTemplates());
}

export async function POST(request: Request) {
  const body = (await request.json()) as TemplateBody;
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Template name is required." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const template: CaptionPromptTemplate = {
    id: uuid(),
    name: body.name.trim(),
    creator: body.creator?.trim() || undefined,
    context: body.context?.trim() || "",
    brandVoice: body.brandVoice?.trim() || undefined,
    cta: body.cta?.trim() || undefined,
    hashtags: body.hashtags?.trim() || undefined,
    includeHashtags: body.includeHashtags ?? true,
    createdAt: now,
    updatedAt: now,
  };
  upsertCaptionPromptTemplate(template);
  return NextResponse.json(template);
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as TemplateBody;
  if (!body.id) return NextResponse.json({ error: "Template id is required." }, { status: 400 });
  const existing = getCaptionPromptTemplate(body.id);
  if (!existing) return NextResponse.json({ error: "Template not found." }, { status: 404 });

  const updated: CaptionPromptTemplate = {
    ...existing,
    name: body.name?.trim() || existing.name,
    creator: body.creator !== undefined ? body.creator.trim() || undefined : existing.creator,
    context: body.context !== undefined ? body.context.trim() : existing.context,
    brandVoice: body.brandVoice !== undefined ? body.brandVoice.trim() || undefined : existing.brandVoice,
    cta: body.cta !== undefined ? body.cta.trim() || undefined : existing.cta,
    hashtags: body.hashtags !== undefined ? body.hashtags.trim() || undefined : existing.hashtags,
    includeHashtags: body.includeHashtags ?? existing.includeHashtags,
    updatedAt: new Date().toISOString(),
  };
  upsertCaptionPromptTemplate(updated);
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Template id is required." }, { status: 400 });
  deleteCaptionPromptTemplate(id);
  return NextResponse.json({ ok: true });
}
