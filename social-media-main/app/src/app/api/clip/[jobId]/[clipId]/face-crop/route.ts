import { NextResponse } from "next/server";
import { getClip } from "@/lib/clip/store";
import { detectFaceCrop } from "@/lib/clip/face-crop";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { jobId, clipId } = await params;

  const clip = getClip(clipId);
  if (!clip) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const aspect = (body.aspect as string) || "9:16";

  try {
    const crop = await detectFaceCrop(jobId, clip.start, clip.end, aspect);
    return NextResponse.json({ crop });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Face detection failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
