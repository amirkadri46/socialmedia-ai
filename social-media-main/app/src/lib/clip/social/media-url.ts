import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

function signingSecret(): string {
  const secret = process.env.CLIP_MEDIA_SIGNING_SECRET || process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error("CLIP_MEDIA_SIGNING_SECRET or CLERK_SECRET_KEY is required to sign clip media URLs.");
  return secret;
}

function sign(clipId: string, exp: number): string {
  return createHmac("sha256", signingSecret())
    .update(`${clipId}.${exp}`)
    .digest("base64url");
}

export function buildSignedClipMediaUrl(appBase: string, clipId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const url = new URL(`/api/clip/media/${clipId}`, appBase);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sign(clipId, exp));
  return url.toString();
}

export function hasValidClipMediaSignature(clipId: string, expValue: string | null, sigValue: string | null): boolean {
  const exp = Number(expValue);
  if (!Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000) || !sigValue) return false;

  const expected = Buffer.from(sign(clipId, exp));
  const actual = Buffer.from(sigValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
