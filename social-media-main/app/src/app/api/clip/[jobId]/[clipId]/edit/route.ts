import { NextResponse } from "next/server";
import {
  getClip,
  getJob,
  readEdit,
  writeEdit,
  getDefaultEdit,
  readTranscript,
} from "@/lib/clip/store";
import type { ClipEdit } from "@/lib/types";

// GET → { edit, words } — loads the saved edit (or a default) plus the source-time
// transcript words the editor needs for the transcript panel and caption timing.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { jobId, clipId } = await params;
  const clip = getClip(clipId);
  const job = getJob(jobId);
  if (!clip || !job) {
    return NextResponse.json({ error: "Clip or job not found" }, { status: 404 });
  }
  const edit = readEdit(clipId) ?? getDefaultEdit(clip, job);
  const words = readTranscript(jobId);
  return NextResponse.json({ edit, words, clip });
}

// PUT → persist the edit document (autosave + explicit Save).
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { clipId } = await params;
  const edit = (await req.json()) as ClipEdit;
  if (!edit || edit.clipId !== clipId) {
    return NextResponse.json({ error: "clipId mismatch" }, { status: 400 });
  }
  edit.updatedAt = new Date().toISOString();
  writeEdit(clipId, edit);
  return NextResponse.json({ ok: true });
}
