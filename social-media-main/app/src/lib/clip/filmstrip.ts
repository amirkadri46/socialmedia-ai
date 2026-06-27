import { existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { ffmpeg, probe } from "./ffmpeg";
import { persistentSourcePath, clipsForJob } from "./store";

// Video thumbnail filmstrip for the timeline (3B).
// One ffmpeg pass extracts ~1 frame/sec and tiles them into a single horizontal
// sprite sheet (frameCount x 1). The timeline slices it with CSS background-position
// instead of issuing N frame requests, so it scales cheaply across zoom.

export interface FilmstripMeta {
  spritePath: string;
  frameCount: number;
  frameW: number;
  frameH: number;
  intervalSec: number; // seconds between sampled frames (= 1/fps)
  sourceDurationSec: number;
  sourceFps: number; // real source frame rate (for frame-by-frame stepping)
}

function jobDir(jobId: string): string {
  return path.join(os.tmpdir(), "social-clipper", jobId);
}

function sourcePath(jobId: string): string {
  const persistent = persistentSourcePath(jobId);
  if (existsSync(persistent)) return persistent;
  const temp = path.join(jobDir(jobId), "source.mp4");
  if (existsSync(temp)) return temp;
  // Fall back to the first rendered clip mp4 when the source is gone.
  const clips = clipsForJob(jobId);
  for (const c of clips) {
    if (c.filePath && existsSync(c.filePath)) return c.filePath;
  }
  return temp; // will trigger the "not found" error in ensureFilmstrip
}

function spritePath(jobId: string, fps: number, thumbH: number): string {
  return path.join(jobDir(jobId), `filmstrip-${fps}-${thumbH}.jpg`);
}

const MAX_TILES = 600; // cap the sprite so very long sources stay cheap

/**
 * Build (and cache) a single-row sprite sheet of source thumbnails. Returns the
 * sprite path plus the geometry the timeline needs to offset per column.
 */
export async function ensureFilmstrip(
  jobId: string,
  fps = 1,
  thumbH = 48
): Promise<FilmstripMeta> {
  const src = sourcePath(jobId);
  if (!existsSync(src)) {
    throw new Error("Source video is no longer available — re-run the clip to view its timeline.");
  }
  const dir = jobDir(jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const { durationSec, width, height, fps: srcFps } = await probe(src);
  // Lower fps if a 1fps sample would exceed the tile cap (keeps the pass bounded).
  let effFps = fps;
  let frameCount = Math.max(1, Math.ceil(durationSec * effFps));
  if (frameCount > MAX_TILES) {
    effFps = MAX_TILES / Math.max(1, durationSec);
    frameCount = Math.max(1, Math.ceil(durationSec * effFps));
  }
  const intervalSec = 1 / effFps;
  const aspect = width && height ? width / height : 16 / 9;
  const frameW = Math.max(2, Math.round(thumbH * aspect));
  const sprite = spritePath(jobId, Math.round(effFps * 1000), thumbH);

  const meta: FilmstripMeta = {
    spritePath: sprite,
    frameCount,
    frameW,
    frameH: thumbH,
    intervalSec,
    sourceDurationSec: durationSec,
    sourceFps: srcFps > 0 ? srcFps : 30,
  };

  if (existsSync(sprite)) return meta; // cached

  // fps=N samples one frame every intervalSec; tile=Cx1 packs them side-by-side.
  await ffmpeg([
    "-y",
    "-i", src,
    "-vf", `fps=${effFps},scale=${frameW}:${thumbH},tile=${frameCount}x1`,
    "-frames:v", "1",
    "-qscale:v", "4",
    sprite,
  ]);

  return meta;
}

export { spritePath, sourcePath };
