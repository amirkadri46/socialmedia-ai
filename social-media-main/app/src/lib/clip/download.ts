import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { run, ytDlpPath, ytDlpAvailable, probe, tmpRoot, ffmpegPath } from "./ffmpeg";

export interface SourceMeta {
  title: string;
  durationSec: number;
  thumbnail: string;
  width: number;
  height: number;
}

function jobDir(jobId: string): string {
  const dir = path.join(tmpRoot(), jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Fetch metadata for a remote video URL without downloading it.
 * Mirrors OpusClip's "fetch video" step — used by the configure screen.
 */
export async function inspect(url: string, cookiesBrowser?: string): Promise<SourceMeta> {
  if (!(await ytDlpAvailable())) {
    throw new Error(
      "yt-dlp is not installed. Install it (brew install yt-dlp / pip install yt-dlp / winget install yt-dlp) or set YT_DLP_PATH. See Settings for details."
    );
  }
  const cookiesArgs = cookiesBrowser ? ["--cookies-from-browser", cookiesBrowser] : [];
  const { stdout } = await run(ytDlpPath(), [
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    ...cookiesArgs,
    url,
  ]);
  const json = JSON.parse(stdout);
  return {
    title: json.title ?? "Untitled video",
    durationSec: Math.round(json.duration ?? 0),
    thumbnail: json.thumbnail ?? "",
    width: json.width ?? 0,
    height: json.height ?? 0,
  };
}

/**
 * Download a remote video to the job temp dir. Returns the local path + metadata.
 * Caps to 1080p to keep render times reasonable.
 */
export async function downloadVideo(
  url: string,
  jobId: string,
  onProgress?: (line: string) => void,
  cookiesBrowser?: string
): Promise<{ path: string; meta: SourceMeta }> {
  if (!(await ytDlpAvailable())) {
    throw new Error(
      "yt-dlp is not installed. Install it or set YT_DLP_PATH. See Settings."
    );
  }
  const dir = jobDir(jobId);
  const outTemplate = path.join(dir, "source.%(ext)s");
  const cookiesArgs = cookiesBrowser ? ["--cookies-from-browser", cookiesBrowser] : [];

  await run(
    ytDlpPath(),
    [
      "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--merge-output-format", "mp4",
      // Use the bundled ffmpeg so merging works without a system ffmpeg on PATH.
      "--ffmpeg-location", path.dirname(ffmpegPath()),
      "--no-playlist",
      "--no-warnings",
      ...cookiesArgs,
      "-o", outTemplate,
      url,
    ],
    {
      onStderr: (chunk) => {
        const m = chunk.match(/\[download\]\s+([\d.]+)%/);
        if (m && onProgress) onProgress(`Downloading ${m[1]}%`);
      },
    }
  );

  const sourcePath = path.join(dir, "source.mp4");
  if (!existsSync(sourcePath)) {
    throw new Error("Download completed but source.mp4 was not produced.");
  }
  const dims = await probe(sourcePath);
  return {
    path: sourcePath,
    meta: {
      title: "",
      durationSec: dims.durationSec,
      thumbnail: "",
      width: dims.width,
      height: dims.height,
    },
  };
}

/** Persist an uploaded file buffer into the job dir (the "Upload" input path). */
export async function saveUpload(
  buffer: Buffer,
  jobId: string,
  ext = "mp4"
): Promise<{ path: string; meta: SourceMeta }> {
  const dir = jobDir(jobId);
  const sourcePath = path.join(dir, `source.${ext}`);
  writeFileSync(sourcePath, buffer);
  const dims = await probe(sourcePath);
  return {
    path: sourcePath,
    meta: { title: "", durationSec: dims.durationSec, thumbnail: "", width: dims.width, height: dims.height },
  };
}

export { jobDir };
