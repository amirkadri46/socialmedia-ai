import { existsSync, mkdirSync, copyFileSync } from "fs";
import path from "path";
import { ffmpeg, videoEncodeArgs } from "./ffmpeg";
import { buildAssFile } from "./captions";
import { clipMediaDir } from "./store";
import type { Word, Moment, ClipJob } from "../types";

/** Target canvas dimensions for an aspect-ratio label. */
export function aspectDims(aspect: string): { w: number; h: number } {
  switch (aspect) {
    case "1:1":
      return { w: 1080, h: 1080 };
    case "16:9":
      return { w: 1920, h: 1080 };
    case "9:16":
    default:
      return { w: 1080, h: 1920 };
  }
}

/**
 * Render a single moment into a finished, captioned vertical clip.
 * One frame-accurate re-encode pass: seek → cover-crop reframe → burn captions/hook.
 * Returns the final mp4 path and a poster thumbnail path (both under data/clips/).
 */
export async function renderClip(
  sourcePath: string,
  words: Word[],
  moment: Moment,
  job: ClipJob,
  clipId: string,
  onProgress?: (line: string) => void
): Promise<{ filePath: string; thumbnail: string }> {
  const { w, h } = aspectDims(job.aspectRatio);
  const duration = Math.max(1, moment.end - moment.start);

  // Work in a per-clip temp dir so the .ass filter can be referenced by basename
  // (avoids Windows drive-letter escaping in ffmpeg filter args).
  const workDir = path.join(path.dirname(sourcePath), `clip-${clipId}`);
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

  const assPath = buildAssFile(
    words,
    job.captionPreset,
    moment.start,
    moment.end,
    workDir,
    w,
    h,
    { hook: job.autoHook ? moment.hook : undefined }
  );

  // Cover-crop to the exact target, then optionally burn the .ass overlay.
  const filters = [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`];
  if (assPath) filters.push(`ass=${path.basename(assPath)}`);

  const outName = `${clipId}.mp4`;
  await ffmpeg(
    [
      "-y",
      "-ss", moment.start.toFixed(3),
      "-i", sourcePath,
      "-t", duration.toFixed(3),
      // Cap encoder threads: libx264's frame-thread buffers are the main per-render
      // memory cost, and uncapped threads on a small container can OOM-kill ffmpeg.
      "-threads", process.env.CLIP_FFMPEG_THREADS || "2",
      "-vf", filters.join(","),
      // CPU libx264 by default; set CLIP_VIDEO_ENCODER=h264_nvenc to encode on an NVIDIA GPU.
      ...videoEncodeArgs(),
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outName,
    ],
    {
      cwd: workDir,
      onStderr: (chunk) => {
        const m = chunk.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m && onProgress) {
          const secs = +m[1] * 3600 + +m[2] * 60 + +m[3];
          onProgress(`Rendering ${Math.min(100, Math.round((secs / duration) * 100))}%`);
        }
      },
    }
  );

  const tmpOut = path.join(workDir, outName);
  // Extract a poster frame ~1s in.
  const tmpThumb = path.join(workDir, `${clipId}.jpg`);
  await ffmpeg([
    "-y",
    "-ss", "1",
    "-i", tmpOut,
    "-frames:v", "1",
    "-q:v", "3",
    tmpThumb,
  ]);

  // Move finished artifacts into the persistent media dir.
  const mediaDir = clipMediaDir();
  const finalPath = path.join(mediaDir, outName);
  const finalThumb = path.join(mediaDir, `${clipId}.jpg`);
  copyFileSync(tmpOut, finalPath);
  if (existsSync(tmpThumb)) copyFileSync(tmpThumb, finalThumb);

  return { filePath: finalPath, thumbnail: existsSync(finalThumb) ? finalThumb : "" };
}
