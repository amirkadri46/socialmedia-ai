import { existsSync, readFileSync } from "fs";
import { getClip } from "@/lib/clip/store";

export const dynamic = "force-dynamic";

/** Serve a clip's poster thumbnail. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const { clipId } = await params;
  const clip = getClip(clipId);
  if (!clip || !clip.thumbnail || !existsSync(clip.thumbnail)) {
    return new Response("Not found", { status: 404 });
  }
  const buf = readFileSync(clip.thumbnail);
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
