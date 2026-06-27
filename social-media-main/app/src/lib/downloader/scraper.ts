import { run, ytDlpPath, ytDlpAvailable } from "@/lib/clip/ffmpeg";
import { detectPlatform, buildCookieArgs } from "./engine";

interface FlatEntry {
  url?: string;
  webpage_url?: string;
  id?: string;
}

/** Profile/channel URL → list of individual video URLs via yt-dlp --flat-playlist. */
export async function scrapeProfileUrls(profileUrl: string, limit?: number): Promise<string[]> {
  if (!(await ytDlpAvailable())) {
    throw new Error("yt-dlp is not installed. Install it or set YT_DLP_PATH.");
  }
  const platform = detectPlatform(profileUrl);

  // For a YouTube @handle, target the /shorts tab unless already scoped.
  let target = profileUrl;
  if (platform === "youtube" && /youtube\.com\/@[^/]+\/?$/i.test(profileUrl)) {
    target = profileUrl.replace(/\/?$/, "/shorts");
  }

  const { stdout } = await run(ytDlpPath(), [
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    ...buildCookieArgs(),
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
