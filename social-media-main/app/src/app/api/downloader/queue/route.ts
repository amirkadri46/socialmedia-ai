import { queueRunner } from "@/lib/downloader/queue-runner";

export const maxDuration = 300; // downloads can take several minutes

export async function GET() {
  queueRunner.ensureStarted();
  return Response.json(queueRunner.getAllJobs());
}

export async function POST(request: Request) {
  queueRunner.ensureStarted();
  const { urls, quality } = await request.json();
  const added = queueRunner.addJobs(urls ?? [], quality);
  return Response.json({ added: added.length });
}

export async function DELETE(request: Request) {
  queueRunner.ensureStarted();
  const body = await request.json().catch(() => ({}));
  if (body.jobId) queueRunner.cancelJob(body.jobId);
  else queueRunner.clearFinished();
  return Response.json({ ok: true });
}
