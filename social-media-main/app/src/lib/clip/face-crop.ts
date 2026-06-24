import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import { ffmpeg, probe } from "./ffmpeg";
import type { CropRect } from "../types";

function openaiClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set — required for face detection.");
  return new OpenAI({ apiKey: key });
}

async function extractFrameBase64(videoPath: string, atSec: number): Promise<string> {
  const tmp = path.join(os.tmpdir(), `face-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  const jpg = path.join(tmp, "frame.jpg");
  try {
    await ffmpeg([
      "-y", "-ss", atSec.toFixed(3), "-i", videoPath,
      "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "5", jpg,
    ]);
    if (!existsSync(jpg)) throw new Error("Frame extraction failed.");
    return readFileSync(jpg).toString("base64");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function detectFaceCenter(
  client: OpenAI,
  base64Jpg: string
): Promise<{ cx: number; cy: number } | null> {
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 60,
    messages: [{
      role: "user",
      content: [
        {
          type: "text",
          text: "Locate the main person's face in this image. Return ONLY valid JSON: {\"cx\":0.5,\"cy\":0.35} where cx=horizontal center (0=left edge, 1=right edge) and cy=vertical center (0=top, 1=bottom). If no face is visible, return {\"cx\":0.5,\"cy\":0.35}.",
        },
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${base64Jpg}`, detail: "low" },
        },
      ],
    }],
  });

  const text = res.choices[0]?.message?.content?.trim() ?? "";
  const match = text.match(/\{[^}]+\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as { cx: number; cy: number };
    if (typeof o.cx !== "number" || typeof o.cy !== "number") return null;
    return {
      cx: Math.min(1, Math.max(0, o.cx)),
      cy: Math.min(1, Math.max(0, o.cy)),
    };
  } catch { return null; }
}

/**
 * Largest face-centered crop of the given pixel aspect (w/h), normalized 0–1 of the source.
 * `faceTopRatio` controls headroom (where the face sits vertically within the crop).
 */
export function buildCropRectForAspect(
  cx: number,
  cy: number,
  srcW: number,
  srcH: number,
  targetAR: number,
  faceTopRatio = 0.28
): CropRect {
  // Guard against a bad probe (0/NaN dims or aspect): a NaN crop rect would crash the
  // downstream ffmpeg `crop=` filter. Fall back to the full frame.
  if (!(srcW > 0) || !(srcH > 0) || !(targetAR > 0)) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const sAR = srcW / srcH;

  let w: number, h: number;
  if (targetAR <= sAR) {
    // Target is narrower: use full source height, crop width to match aspect
    h = 1;
    w = targetAR / sAR;
  } else {
    // Target is wider: use full source width, crop height
    w = 1;
    h = sAR / targetAR;
  }

  const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y = Math.min(Math.max(cy - h * faceTopRatio, 0), 1 - h);

  return { x, y, w, h };
}

export function buildCropRect(
  cx: number,
  cy: number,
  srcW: number,
  srcH: number,
  aspect: string
): CropRect {
  const tAR = aspect === "1:1" ? 1 : aspect === "16:9" ? 16 / 9 : 9 / 16;
  // Place the face at ~28% from the top (more headroom on wide crops).
  return buildCropRectForAspect(cx, cy, srcW, srcH, tAR, aspect === "16:9" ? 0.4 : 0.28);
}

/**
 * Sample N frames from the given clip time range, detect the main speaker's
 * face center via GPT-4o Vision, and return an averaged face-centered CropRect.
 */
export async function detectFaceCrop(
  jobId: string,
  clipStart: number,
  clipEnd: number,
  aspect: string,
  samples = 3
): Promise<CropRect> {
  const srcPath = path.join(os.tmpdir(), "social-clipper", jobId, "source.mp4");
  if (!existsSync(srcPath)) {
    throw new Error(
      "Source video is not available — re-run the clipping job to enable face detection."
    );
  }

  const { width: srcW, height: srcH } = await probe(srcPath);
  const client = openaiClient();
  const dur = Math.max(1, clipEnd - clipStart);
  const centers: { cx: number; cy: number }[] = [];

  for (let i = 1; i <= samples; i++) {
    const t = clipStart + (dur * i) / (samples + 1);
    try {
      const b64 = await extractFrameBase64(srcPath, t);
      const c = await detectFaceCenter(client, b64);
      if (c) centers.push(c);
    } catch {
      // Skip failed sample — continue with remaining
    }
  }

  if (centers.length === 0) {
    // Fallback: sensible default center crop
    return buildCropRect(0.5, 0.35, srcW, srcH, aspect);
  }

  const cx = centers.reduce((s, c) => s + c.cx, 0) / centers.length;
  const cy = centers.reduce((s, c) => s + c.cy, 0) / centers.length;
  return buildCropRect(cx, cy, srcW, srcH, aspect);
}
