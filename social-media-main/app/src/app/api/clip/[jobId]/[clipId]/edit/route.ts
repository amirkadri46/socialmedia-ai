import { NextResponse } from "next/server";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { repos } from "@/lib/db";
import { persistentSourcePath } from "@/lib/clip/store";
import type { ClipEdit } from "@/lib/types";

function sourceExists(jobId: string): boolean {
  if (existsSync(persistentSourcePath(jobId))) return true;
  return existsSync(path.join(os.tmpdir(), "social-clipper", jobId, "source.mp4"));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { jobId, clipId } = await params;
  const [clip, job, rawWords] = await Promise.all([
    repos.clips.get(clipId),
    repos.clipJobs.get(jobId),
    repos.clipTranscripts.get(jobId),
  ]);
  if (!clip || !job) {
    return NextResponse.json({ error: "Clip or job not found" }, { status: 404 });
  }
  const edit = (await repos.clipEdits.get(clipId)) ?? repos.clipEdits.getDefault(clip, job);
  const sourceAvailable = sourceExists(jobId);

  if (sourceAvailable) {
    return NextResponse.json({ edit, words: rawWords, clip, sourceAvailable: true });
  }

  // Source file is gone — remap timestamps to clip-relative coords (clip mp4 starts at t=0).
  const offset = clip.start;
  const clipDuration = clip.end - clip.start;
  // Convert source-relative → clip-relative, then clamp to [0, clipDuration].
  const savedIn = edit.sourceInSec - offset;
  const savedOut = edit.sourceOutSec - offset;
  const inBounds = savedIn >= 0 && savedOut <= clipDuration && savedIn < savedOut;
  const adjustedEdit: ClipEdit = {
    ...edit,
    sourceInSec: inBounds ? savedIn : 0,
    sourceOutSec: inBounds ? savedOut : clipDuration,
  };
  const adjustedWords = (rawWords ?? [])
    .filter((w) => w.end > clip.start - 0.1 && w.start < clip.end + 0.1)
    .map((w) => ({ ...w, start: +(w.start - offset).toFixed(4), end: +(w.end - offset).toFixed(4) }));

  return NextResponse.json({
    edit: adjustedEdit,
    words: adjustedWords,
    clip,
    sourceAvailable: false,
    sourceVideoUrl: `/api/clip/media/${clipId}`,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { clipId } = await params;
  let edit: ClipEdit;
  try {
    edit = (await req.json()) as ClipEdit;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }
  if (!edit || edit.clipId !== clipId) {
    return NextResponse.json({ error: "clipId mismatch" }, { status: 400 });
  }
  edit.updatedAt = new Date().toISOString();
  await repos.clipEdits.write(clipId, edit);
  return NextResponse.json({ ok: true });
}
