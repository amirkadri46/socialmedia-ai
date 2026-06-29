import os from "os";
import path from "path";
import { mkdirSync, readdirSync, existsSync, writeFileSync } from "fs";
import { run, ytDlpPath, ffmpegPath, ytDlpAvailable } from "@/lib/clip/ffmpeg";
import { cookieArgs } from "@/lib/clip/download";
import { repos } from "@/lib/db";
import { scrapeVideoByUrl } from "@/lib/apify";
import type { DownloadPlatform, DownloadQuality } from "./types";

export function detectPlatform(url: string): DownloadPlatform {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/instagram\.com/i.test(url)) return "instagram";
  return "unknown";
}

function withInstagramHint(url: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (!/instagram\.com/i.test(url)) return new Error(message);
  return new Error(`${message} Instagram downloads usually need fresh instagram.com cookies in Settings > Clipping, or YTDLP_COOKIES_TEXT on Railway.`);
}

function instagramScrapeError(): Error {
  return new Error(
    "Couldn't fetch this Instagram Reel via Apify. Check your Apify API token in Settings and that the Reel is public. (yt-dlp fallback is disabled for Instagram.)"
  );
}

async function scrapeInstagram(url: string) {
  try {
    return await scrapeVideoByUrl(url);
  } catch {
    return null;
  }
}

/** Cookie args from Clip Settings — reuses the clip pipeline's logic (incl. env fallback). */
export async function buildCookieArgs(): Promise<string[]> {
  const s = await repos.settings.get();
  return cookieArgs(s.ytDlpCookiesBrowser, s.ytDlpCookiesText);
}

export function qualityFormat(q: DownloadQuality): string {
  if (q === "720p") return "bv*[height<=720]+ba/b[height<=720]/b";
  // best is capped at 1080p to keep file sizes sane
  return "bv*[height<=1080]+ba/b[height<=1080]/b";
}

function getTempDir(jobId: string): string {
  const dir = path.join(os.tmpdir(), "social-dl", jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function inspectUrl(
  url: string
): Promise<{ title: string; creator: string; thumbnail: string; platform: DownloadPlatform }> {
  const platform = detectPlatform(url);
  const reel = platform === "instagram" ? await scrapeInstagram(url) : null;
  if (reel?.videoUrl) {
    return {
      title: url,
      creator: reel.ownerUsername || "Instagram",
      thumbnail: reel.displayUrl || reel.images?.[0] || "",
      platform: "instagram",
    };
  }
  // Instagram is Apify-only — yt-dlp just hits IG's login wall, so fail clearly
  // instead of falling back to it.
  if (platform === "instagram") throw instagramScrapeError();
  if (!(await ytDlpAvailable())) {
    throw new Error("yt-dlp is not installed. Install it or set YT_DLP_PATH.");
  }
  let stdout: string;
  try {
    ({ stdout } = await run(ytDlpPath(), [
      "--dump-single-json",
      "--no-warnings",
      "--no-playlist",
      ...await buildCookieArgs(),
      url,
    ]));
  } catch (err) {
    throw withInstagramHint(url, err);
  }
  const json = JSON.parse(stdout);
  return {
    title: json.title || "Untitled",
    creator: json.uploader || json.channel || json.uploader_id || "Unknown",
    thumbnail: json.thumbnail || "",
    platform,
  };
}

async function downloadUrl(url: string, filePath: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Download failed ${response.status}`);
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()));
}

export async function downloadSingleJob(
  job: { url: string; platform: DownloadPlatform; id: string },
  quality: DownloadQuality,
  onProgress: (progress: number, speed: string, eta: string) => void,
  signal?: AbortSignal
): Promise<{ videoPath: string; thumbPath: string | null }> {
  const tempDir = getTempDir(job.id);
  const outTemplate = path.join(tempDir, "%(title)s.%(ext)s");
  const reel = job.platform === "instagram" ? await scrapeInstagram(job.url) : null;
  if (reel?.videoUrl) {
    const videoPath = path.join(tempDir, "instagram.mp4");
    const thumbUrl = reel.displayUrl || reel.images?.[0];
    const thumbPath = thumbUrl ? path.join(tempDir, "instagram.jpg") : null;
    await downloadUrl(reel.videoUrl, videoPath, signal);
    if (thumbUrl && thumbPath) await downloadUrl(thumbUrl, thumbPath, signal).catch(() => {});
    onProgress(100, "", "");
    return { videoPath, thumbPath };
  }
  if (job.platform === "instagram") throw instagramScrapeError();
  if (!(await ytDlpAvailable())) {
    throw new Error("yt-dlp is not installed. Install it or set YT_DLP_PATH.");
  }

  try {
    await run(
      ytDlpPath(),
      [
        "-f", qualityFormat(quality),
        "--merge-output-format", "mp4",
        "--write-thumbnail",
        "--convert-thumbnails", "jpg",
        "--ffmpeg-location", path.dirname(ffmpegPath()),
        "--no-playlist",
        "--no-warnings",
        ...await buildCookieArgs(),
        "-o", outTemplate,
        job.url,
      ],
      {
        onStderr: (chunk) => {
          const m = chunk.match(/\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)/);
          if (m) onProgress(parseFloat(m[1]), m[2], m[3]);
        },
        signal,
      }
    );
  } catch (err) {
    throw withInstagramHint(job.url, err);
  }

  // Find the downloaded mp4 and jpg in the temp dir
  const files = readdirSync(tempDir);
  const videoPath = files.find((f) => f.endsWith(".mp4"))
    ? path.join(tempDir, files.find((f) => f.endsWith(".mp4"))!)
    : null;
  const thumbPath = files.find((f) => f.endsWith(".jpg"))
    ? path.join(tempDir, files.find((f) => f.endsWith(".jpg"))!)
    : null;

  if (!videoPath) throw new Error("yt-dlp completed but no .mp4 file found in temp dir");
  return { videoPath, thumbPath };
}
