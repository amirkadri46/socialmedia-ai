import { readDownloaderSettings, writeDownloaderSettings } from "@/lib/downloader/store";

export async function GET() {
  return Response.json(readDownloaderSettings());
}

export async function POST(request: Request) {
  const body = await request.json();
  writeDownloaderSettings(body);
  return Response.json({ ok: true });
}
