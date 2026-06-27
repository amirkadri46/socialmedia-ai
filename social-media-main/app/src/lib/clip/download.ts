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
 * Build the yt-dlp cookie args. A pasted cookies.txt (Netscape format) is the
 * only thing that works on a server like Railway, where no browser is installed
 * for `--cookies-from-browser`. The file takes priority; the browser is a local
 * fallback. Without one of these, YouTube blocks datacenter IPs with the
 * "Sign in to confirm you're not a bot" error.
 */
export function cookieArgs(cookiesBrowser?: string, cookiesText?: string): string[] {
  // Env var wins on hosted deploys (Railway): it survives redeploys, unlike the
  // settings.json textarea which lives on an ephemeral filesystem.
  const text = (cookiesText && cookiesText.trim()) ? cookiesText : process.env.YTDLP_COOKIES;
  if (text && text.trim()) {
    const cookiesText = text; // shadow so the block below is unchanged
    const dir = tmpRoot();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "yt-cookies.txt");
    // yt-dlp requires a leading Netscape header and LF line endings.
    let body = cookiesText.replace(/\r\n/g, "\n").trim();
    if (!body.startsWith("# Netscape HTTP Cookie File") && !body.startsWith("# HTTP Cookie File")) {
      body = `# Netscape HTTP Cookie File\n${body}`;
    }
    writeFileSync(file, `${body}\n`, "utf-8");
    return ["--cookies", file];
  }
  if (cookiesBrowser) return ["--cookies-from-browser", cookiesBrowser];
  return [];
}

/**
 * Fetch metadata for a remote video URL without downloading it.
 * Mirrors OpusClip's "fetch video" step — used by the configure screen.
 */
export async function inspect(url: string, cookiesBrowser?: string, cookiesText?: string): Promise<SourceMeta> {
  if (!(await ytDlpAvailable())) {
    throw new Error(
      "yt-dlp is not installed. Install it (brew install yt-dlp / pip install yt-dlp / winget install yt-dlp) or set YT_DLP_PATH. See Settings for details."
    );
  }
  const cookiesArgs = cookieArgs(cookiesBrowser, cookiesText);
  const { stdout } = await run(ytDlpPath(), [
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    ...cookiesArgs,
    url,
  ]);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error(
      `yt-dlp returned invalid JSON for "${url}". Output: ${stdout.slice(0, 200)}`
    );
  }
  const meta = json as { title?: string; duration?: number; thumbnail?: string; width?: number; height?: number };
  return {
    title: meta.title ?? "Untitled video",
    durationSec: Math.round(meta.duration ?? 0),
    thumbnail: meta.thumbnail ?? "",
    width: meta.width ?? 0,
    height: meta.height ?? 0,
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
  cookiesBrowser?: string,
  cookiesText?: string
): Promise<{ path: string; meta: SourceMeta }> {
  if (!(await ytDlpAvailable())) {
    throw new Error(
      "yt-dlp is not installed. Install it or set YT_DLP_PATH. See Settings."
    );
  }
  const dir = jobDir(jobId);
  const outTemplate = path.join(dir, "source.%(ext)s");
  const cookiesArgs = cookieArgs(cookiesBrowser, cookiesText);

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
