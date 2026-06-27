import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import { ffmpegPath } from "./ffmpeg";
import { persistentSourcePath, clipsForJob } from "./store";
import { spawn } from "child_process";

// Audio waveform peaks for the timeline (3B).
// NOTE: Aamir described this as "pitch high/low", but the reference (image 4) and the
// standard waveform UI show an AMPLITUDE ENVELOPE — loud vs quiet bars, not literal
// pitch (fundamental frequency / F0). We compute the amplitude envelope: decode the
// source to mono 8kHz PCM, then reduce to `buckets` normalized peak magnitudes (0–1).

function jobDir(jobId: string): string {
  return path.join(os.tmpdir(), "social-clipper", jobId);
}

function sourcePath(jobId: string): string {
  const persistent = persistentSourcePath(jobId);
  if (existsSync(persistent)) return persistent;
  const temp = path.join(jobDir(jobId), "source.mp4");
  if (existsSync(temp)) return temp;
  const clips = clipsForJob(jobId);
  for (const c of clips) {
    if (c.filePath && existsSync(c.filePath)) return c.filePath;
  }
  return temp;
}

function peaksPath(jobId: string, buckets: number): string {
  return path.join(jobDir(jobId), `waveform-${buckets}.json`);
}

/** Decode mono PCM and reduce to `buckets` normalized peak amplitudes (cached job-level). */
export async function ensureWaveform(jobId: string, buckets = 1200): Promise<number[]> {
  const src = sourcePath(jobId);
  if (!existsSync(src)) {
    throw new Error("Source video is no longer available — re-run the clip to view its timeline.");
  }
  const dir = jobDir(jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const cache = peaksPath(jobId, buckets);
  if (existsSync(cache)) {
    try {
      return JSON.parse(readFileSync(cache, "utf-8")) as number[];
    } catch {
      /* fall through and regenerate */
    }
  }

  const pcm = await decodePcm(src);
  const peaks = reducePeaks(pcm, buckets);
  writeFileSync(cache, JSON.stringify(peaks), "utf-8");
  return peaks;
}

/** Stream mono 8kHz signed-16 PCM from ffmpeg into a single Buffer. */
function decodePcm(src: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath(),
      ["-v", "error", "-i", src, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
      { windowsHide: true }
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (d) => chunks.push(d as Buffer));
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg PCM decode exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/** Reduce s16le PCM to `buckets` normalized (0–1) peak amplitudes. */
function reducePeaks(pcm: Buffer, buckets: number): number[] {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return new Array(buckets).fill(0);
  const per = Math.max(1, Math.floor(samples / buckets));
  const peaks: number[] = [];
  let max = 1;
  for (let b = 0; b < buckets; b++) {
    let peak = 0;
    const start = b * per;
    const end = Math.min(samples, start + per);
    for (let i = start; i < end; i++) {
      const v = Math.abs(pcm.readInt16LE(i * 2));
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  return peaks.map((p) => +(p / max).toFixed(3));
}
