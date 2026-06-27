import { readQueue } from "@/lib/downloader/store";

// Video library = completed downloads from the Downloader.
// Content pipeline videos (scraped Instagram reels) are kept completely separate.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform") ?? undefined;
  const search = searchParams.get("search")?.toLowerCase();
  const limit = parseInt(searchParams.get("limit") ?? "200");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  let videos = readQueue()
    .filter((j) => j.status === "completed")
    .map((j) => ({
      id: j.videoLibraryId || j.id,
      title: j.title,
      creator: j.creator || null,
      platform: j.platform,
      duration_sec: null as number | null,
      publish_status: "unpublished",
      storage_status: "available",
      downloaded_at: j.addedAt,
      thumbnail_url: j.thumbnail || null,
    }));

  if (platform) videos = videos.filter((v) => v.platform === platform);
  if (search) {
    videos = videos.filter(
      (v) =>
        v.title.toLowerCase().includes(search) ||
        (v.creator ?? "").toLowerCase().includes(search)
    );
  }

  return Response.json(videos.slice(offset, offset + limit));
}
