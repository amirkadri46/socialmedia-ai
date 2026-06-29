import { NextResponse } from "next/server";
import { repos } from "@/lib/db";
import { purgeClipFiles } from "@/lib/clip/storage";

/** Delete a single clip: its media (storage + local) and its DB/CSV row. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { jobId, clipId } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(clipId)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  // Scope the delete to this job so a clip can't be removed via the wrong job's URL.
  const clip = await repos.clips.get(clipId);
  if (!clip || clip.jobId !== jobId) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  await purgeClipFiles(clipId);
  await repos.clips.delete(clipId); // clip_edits cascade in supabase mode
  return NextResponse.json({ ok: true });
}
