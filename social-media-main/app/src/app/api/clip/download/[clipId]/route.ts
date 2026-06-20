import { existsSync, readFileSync } from "fs";
import path from "path";
import { getClip } from "@/lib/clip/store";

export const dynamic = "force-dynamic";

/** Serve a rendered clip as a file download (attachment). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const { clipId } = await params;
  const clip = getClip(clipId);
  if (!clip || !clip.filePath || !existsSync(clip.filePath)) {
    return new Response("Not found", { status: 404 });
  }
  const buf = readFileSync(clip.filePath);
  const safeName =
    (clip.title || "clip").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50) +
    path.extname(clip.filePath);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(buf.length),
    },
  });
}
