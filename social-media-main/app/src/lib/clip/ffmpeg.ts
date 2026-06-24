import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import os from "os";

// ── Binary resolution ─────────────────────────────────────────────────────────────
// ffmpeg-static / ffprobe-static ship platform binaries. yt-dlp is expected on PATH
// (or via YT_DLP_PATH) — see PRD §2.1; it cannot be bundled reliably cross-platform.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegStatic: string | null = require("ffmpeg-static");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic: { path: string } = require("ffprobe-static");

export function ffmpegPath(): string {
  const p = ffmpegStatic;
  if (!p || !existsSync(p)) throw new Error("ffmpeg binary not found (ffmpeg-static).");
  return p;
}

export function ffprobePath(): string {
  const p = ffprobeStatic?.path;
  if (!p || !existsSync(p)) throw new Error("ffprobe binary not found (ffprobe-static).");
  return p;
}

export function ytDlpPath(): string {
  return process.env.YT_DLP_PATH || "yt-dlp";
}

export function tmpRoot(): string {
  return path.join(os.tmpdir(), "social-clipper");
}

// ── Process runner ────────────────────────────────────────────────────────────────

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Run a binary, capturing stdout/stderr. Rejects on non-zero exit. */
export function run(
  bin: string,
  args: string[],
  opts: { onStderr?: (chunk: string) => void; cwd?: string } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(bin, args, { windowsHide: true, cwd: opts.cwd });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    proc.on("error", (err) => {
      reject(
        new Error(
          `Failed to launch "${bin}": ${err instanceof Error ? err.message : err}`
        )
      );
    });
    proc.on("close", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else if (code === null) {
        // A null exit code means the process was terminated by a signal rather than
        // exiting on its own — on a memory-constrained host this is almost always the
        // OOM killer (SIGKILL). Give an actionable message instead of the raw banner.
        reject(
          new Error(
            `${path.basename(bin)} was killed (signal ${signal ?? "unknown"}) — likely out of memory. ` +
              `Try fewer concurrent renders (CLIP_RENDER_CONCURRENCY=1) or more container memory.`
          )
        );
      } else reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export const ffmpeg = (
  args: string[],
  opts?: { onStderr?: (c: string) => void; cwd?: string }
) => run(ffmpegPath(), args, opts);

export const ffprobe = (args: string[]) => run(ffprobePath(), args);

/** Parse an ffprobe rational frame-rate string like "30000/1001" → 29.97. */
function parseFps(s?: string): number {
  if (!s) return 0;
  const [n, d] = s.split("/").map(Number);
  if (!d) return n || 0;
  return d ? n / d : 0;
}

/** Probe a media file's duration (seconds), dimensions, and frame rate. */
export async function probe(
  file: string
): Promise<{ durationSec: number; width: number; height: number; fps: number }> {
  const { stdout } = await ffprobe([
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const json = JSON.parse(stdout);
  const durationSec = parseFloat(json?.format?.duration ?? "0") || 0;
  const v = (json?.streams ?? []).find(
    (s: { codec_type?: string }) => s.codec_type === "video"
  );
  return {
    durationSec,
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: parseFps(v?.avg_frame_rate) || parseFps(v?.r_frame_rate) || 0,
  };
}

/** True if yt-dlp is callable on this machine. */
export async function ytDlpAvailable(): Promise<boolean> {
  try {
    await run(ytDlpPath(), ["--version"]);
    return true;
  } catch {
    return false;
  }
}
