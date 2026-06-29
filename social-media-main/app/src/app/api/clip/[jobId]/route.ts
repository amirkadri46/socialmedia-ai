import { NextResponse } from "next/server";
import { repos } from "@/lib/db";
import { purgeClipFiles, purgeJobFiles } from "@/lib/clip/storage";

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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  // Don't purge a job that's still working — its worker is mid-download/transcribe/render
  // and would keep writing files after we delete them. Only terminal jobs are purgeable;
  // an active job must be canceled first (the cancel route flips it to "canceled").
  const job = await repos.clipJobs.get(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const TERMINAL = new Set(["done", "error", "canceled"]);
  if (!TERMINAL.has(job.status)) {
    return NextResponse.json(
      { error: "Job is still running. Cancel it before deleting." },
      { status: 409 }
    );
  }
  // Remove every clip's media + DB row, then the job's source/transcript, then the job
  // itself — so nothing is orphaned in Supabase Storage / on local disk. (The DB rows
  // also cascade via FK in supabase mode; deleting them here keeps file mode in sync.)
  const clips = await repos.clips.forJob(jobId);
  for (const clip of clips) {
    await purgeClipFiles(clip.id);
    await repos.clips.delete(clip.id);
  }
  await purgeJobFiles(jobId);
  await repos.clipJobs.delete(jobId);
  return NextResponse.json({ ok: true });
}
