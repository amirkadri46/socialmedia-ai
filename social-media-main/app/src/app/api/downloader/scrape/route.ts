import { scrapeProfileUrls } from "@/lib/downloader/scraper";
import { assertPublicHttpUrl } from "@/lib/security/url";

export const maxDuration = 120; // scraping a full profile can take time

export async function POST(request: Request) {
  try {
    const { url, limit } = await request.json();
    const safeUrl = await assertPublicHttpUrl(url);
    const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : undefined;
    const urls = await scrapeProfileUrls(safeUrl, safeLimit);
    return Response.json({ urls });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
