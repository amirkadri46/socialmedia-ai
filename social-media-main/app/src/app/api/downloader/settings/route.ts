import { readDownloaderSettings, writeDownloaderSettings } from "@/lib/downloader/store";
import type { DownloaderSettings } from "@/lib/downloader/types";

export async function GET() {
  return Response.json(readDownloaderSettings());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const current = readDownloaderSettings();
  const settings: DownloaderSettings = {
    quality: body.quality === "720p" || body.quality === "1080p" || body.quality === "best" ? body.quality : current.quality,
    concurrentDownloads:
      Number.isInteger(body.concurrentDownloads) && body.concurrentDownloads > 0 && body.concurrentDownloads <= 10
        ? body.concurrentDownloads
        : current.concurrentDownloads,
    retryCount:
      Number.isInteger(body.retryCount) && body.retryCount >= 0 && body.retryCount <= 10
        ? body.retryCount
        : current.retryCount,
    skipDuplicates: typeof body.skipDuplicates === "boolean" ? body.skipDuplicates : current.skipDuplicates,
  };
  writeDownloaderSettings(settings);
  return Response.json({ ok: true });
}
