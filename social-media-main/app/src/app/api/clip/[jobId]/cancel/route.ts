import { NextResponse } from "next/server";
import { getJob, requestCancel } from "@/lib/clip/store";

const TERMINAL = new Set(["done", "error", "canceled"]);

/** Request cancellation of a running clip pipeline. The pipeline stops at its next step boundary. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (TERMINAL.has(job.status)) {
    return NextResponse.json({ ok: true, alreadyDone: true, status: job.status });
  }
  requestCancel(jobId);
  return NextResponse.json({ ok: true });
}
