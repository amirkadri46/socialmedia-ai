import { NextResponse } from "next/server";
import { repos } from "@/lib/db";
import { autoFrameSegments } from "@/lib/clip/autoframe";
import { editedDuration, windowToEdited } from "@/lib/clip/edit-timeline";
import type { LayoutSegment } from "@/lib/types";

export const dynamic = "force-dynamic";

// POST { aspect } → { layout } — auto Fill/Fit segmentation for the whole clip (3C).
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
  const aspect = (body.aspect as string) || edit.aspectRatio || "9:16";

  try {
    // Detection returns clip-local (window) seconds; map them onto the edited timeline
    // (collapses removed gaps) and drop any segment that lands inside a cut.
    const windowSegs = await autoFrameSegments(jobId, edit.sourceInSec, edit.sourceOutSec, aspect);
    const dur = editedDuration(edit);
    const layout: LayoutSegment[] = [];
    for (const s of windowSegs) {
      const start = windowToEdited(edit, s.start);
      const end = windowToEdited(edit, s.end);
      if (end - start < 0.05) continue; // collapsed by a removal
      layout.push({ ...s, start, end });
    }
    // Snap the ends so the layout fully covers the edited timeline.
    if (layout.length) {
      layout[0].start = 0;
      layout[layout.length - 1].end = dur;
    }
    return NextResponse.json({ layout });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Auto reframe failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
