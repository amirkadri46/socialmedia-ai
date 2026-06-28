import { queueRunner } from "@/lib/downloader/queue-runner";
import { assertPublicHttpUrl } from "@/lib/security/url";
import type { DownloadQuality } from "@/lib/downloader/types";

export const maxDuration = 300; // downloads can take several minutes

export async function GET() {
  queueRunner.ensureStarted();
  return Response.json(queueRunner.getAllJobs());
}

export async function POST(request: Request) {
  queueRunner.ensureStarted();
  try {
    const body = (await request.json()) as { urls?: unknown; quality?: unknown };
    if (!Array.isArray(body.urls)) return Response.json({ error: "urls must be an array." }, { status: 400 });
    const urls = await Promise.all(body.urls.map((url) => assertPublicHttpUrl(url)));
    const quality: DownloadQuality =
      body.quality === "720p" || body.quality === "1080p" || body.quality === "best" ? body.quality : "best";
    const added = queueRunner.addJobs(urls, quality);
    return Response.json({ added: added.length });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid request." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  queueRunner.ensureStarted();
  const body = await request.json().catch(() => ({}));
  if (body.jobId) queueRunner.cancelJob(body.jobId);
  else queueRunner.clearFinished();
  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  queueRunner.ensureStarted();
  const body = await request.json().catch(() => ({}));
  if (body.action === "pause") queueRunner.pauseJob(body.jobId);
  if (body.action === "resume") queueRunner.resumeJob(body.jobId);
  return Response.json({ ok: true });
}
