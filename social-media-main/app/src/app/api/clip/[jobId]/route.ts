import { NextResponse } from "next/server";
import { getJob, clipsForJob, getLiveProgress } from "@/lib/clip/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  // Include the live progress snapshot (percent/logs/ETA) if the pipeline is still
  // running — lets a reconnecting client resume the processing view, not just status.
  return NextResponse.json({ job, clips: clipsForJob(jobId), progress: getLiveProgress(jobId) ?? null });
}
