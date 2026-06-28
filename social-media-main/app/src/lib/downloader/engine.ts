import os from "os";
import path from "path";
import { mkdirSync, readdirSync, existsSync } from "fs";
import { run, ytDlpPath, ffmpegPath, ytDlpAvailable } from "@/lib/clip/ffmpeg";
import { cookieArgs } from "@/lib/clip/download";
import { repos } from "@/lib/db";
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
    platform: detectPlatform(url),
  };
}

export async function downloadSingleJob(
  job: { url: string; platform: DownloadPlatform; id: string },
  quality: DownloadQuality,
  onProgress: (progress: number, speed: string, eta: string) => void
): Promise<{ videoPath: string; thumbPath: string | null }> {
  if (!(await ytDlpAvailable())) {
    throw new Error("yt-dlp is not installed. Install it or set YT_DLP_PATH.");
  }
  const tempDir = getTempDir(job.id);
  const outTemplate = path.join(tempDir, "%(title)s.%(ext)s");

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
