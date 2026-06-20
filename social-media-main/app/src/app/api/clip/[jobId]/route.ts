import { NextResponse } from "next/server";
import { getJob, clipsForJob } from "@/lib/clip/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job, clips: clipsForJob(jobId) });
}
