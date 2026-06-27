import { NextResponse } from "next/server";
import { repos } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const [job, clips, progress] = await Promise.all([
    repos.clipJobs.get(jobId),
    repos.clips.forJob(jobId),
    repos.clipJobs.getProgress(jobId),
  ]);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ job, clips, progress: progress ?? null });
}
