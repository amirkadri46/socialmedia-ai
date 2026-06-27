import { NextResponse } from "next/server";
import { repos } from "@/lib/db";

const TERMINAL = new Set(["done", "error", "canceled"]);

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = await repos.clipJobs.get(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (TERMINAL.has(job.status)) {
    return NextResponse.json({ ok: true, alreadyDone: true, status: job.status });
  }
  repos.clipJobs.requestCancel(jobId);
  return NextResponse.json({ ok: true });
}
