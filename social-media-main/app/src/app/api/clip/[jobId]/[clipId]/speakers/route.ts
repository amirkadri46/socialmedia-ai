import { NextResponse } from "next/server";
import { repos } from "@/lib/db";
import { detectSpeakerPanes } from "@/lib/clip/autoframe";
import { aspectRatioValue } from "@/lib/clip/layout-geom";
import { editedToWindow } from "@/lib/clip/edit-timeline";
import type { LayoutKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: LayoutKind[] = ["split", "triple", "quad"];

// POST { kind, segStart?, segEnd? } → { panes } — detect speaker face-crops for a
// multi-speaker layout (3D). segStart/segEnd are edited-timeline seconds bounding the
// segment to sample; absent = the whole clip window.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { jobId, clipId } = await params;
  const edit = await repos.clipEdits.get(clipId);
  if (!edit) {
    return NextResponse.json({ error: "Edit not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const kind = body.kind as LayoutKind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "Invalid layout kind." }, { status: 400 });
  }

  // Map the segment's edited bounds back into the source window for frame sampling.
  const inSec = edit.sourceInSec + (typeof body.segStart === "number" ? editedToWindow(edit, body.segStart) : 0);
  const outSec =
    typeof body.segEnd === "number"
      ? edit.sourceInSec + editedToWindow(edit, body.segEnd)
      : edit.sourceOutSec;
  const canvasAR = aspectRatioValue(edit.aspectRatio);

  try {
    const panes = await detectSpeakerPanes(jobId, inSec, Math.max(inSec + 0.5, outSec), kind, canvasAR);
    return NextResponse.json({ panes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Speaker detection failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
