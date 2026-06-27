import { scrapeProfileUrls } from "@/lib/downloader/scraper";

export const maxDuration = 120; // scraping a full profile can take time

export async function POST(request: Request) {
  try {
    const { url, limit } = await request.json();
    const urls = await scrapeProfileUrls(url, limit);
    return Response.json({ urls });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
