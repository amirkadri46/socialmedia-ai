import { run, ytDlpPath, ytDlpAvailable } from "@/lib/clip/ffmpeg";
import { detectPlatform, buildCookieArgs } from "./engine";
import { scrapeReels } from "@/lib/apify";

interface FlatEntry {
  url?: string;
  webpage_url?: string;
  id?: string;
}

/** Extract a profile username from an instagram.com URL (null for reel/p/etc. paths). */
function instagramUsername(url: string): string | null {
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  if (!m) return null;
  const u = m[1];
  if (["reel", "reels", "p", "tv", "stories", "explore"].includes(u.toLowerCase())) return null;
  return u;
}

/** Instagram profile → reel URLs via Apify (yt-dlp's instagram:user extractor is unreliable). */
async function scrapeInstagramProfile(profileUrl: string, limit?: number): Promise<string[]> {
  const username = instagramUsername(profileUrl);
  if (!username) throw new Error("Could not parse an Instagram username from that URL.");
  // No date window for the downloader — ~10y back so "All videos" works.
  const reels = await scrapeReels(username, limit ?? 200, 3650);
  const urls = reels.map((r) => r.url).filter(Boolean);
  if (urls.length === 0) {
    throw new Error("No videos found — the profile may be private, or Apify returned nothing.");
  }
  return limit ? urls.slice(0, limit) : urls;
}

/** Profile/channel URL → list of individual video URLs. */
export async function scrapeProfileUrls(profileUrl: string, limit?: number): Promise<string[]> {
  const platform = detectPlatform(profileUrl);

  if (platform === "instagram") return scrapeInstagramProfile(profileUrl, limit);

  if (!(await ytDlpAvailable())) {
    throw new Error("yt-dlp is not installed. Install it or set YT_DLP_PATH.");
  }

  // For a YouTube @handle, target the /shorts tab unless already scoped.
  let target = profileUrl;
  if (platform === "youtube" && /youtube\.com\/@[^/]+\/?$/i.test(profileUrl)) {
    target = profileUrl.replace(/\/?$/, "/shorts");
  }

  const { stdout } = await run(ytDlpPath(), [
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    ...await buildCookieArgs(),
    target,
  ]);

  const json = JSON.parse(stdout);
  const entries: FlatEntry[] = json.entries || [];
  const urls = entries
    .map((e) => {
      if (e.url) return e.url;
      if (e.webpage_url) return e.webpage_url;
      if (e.id) {
        return platform === "youtube"
          ? `https://www.youtube.com/shorts/${e.id}`
          : `https://www.instagram.com/reel/${e.id}`;
      }
      return "";
    })
    .filter(Boolean) as string[];

  if (urls.length === 0) {
    throw new Error(
      "No videos found. The profile may be private, or Instagram requires cookies (set them in Settings → Clipping)."
    );
  }

  return limit ? urls.slice(0, limit) : urls;
}
