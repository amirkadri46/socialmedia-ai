import { existsSync, readFileSync } from "fs";
import { repos } from "@/lib/db";
import { serverClient } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Serve a clip's poster thumbnail. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const { clipId } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(clipId)) {
    return new Response("Bad request", { status: 400 });
  }

  const clip = await repos.clips.get(clipId);
  if (!clip || !clip.thumbnail) {
    return new Response("Not found", { status: 404 });
  }

  // In supabase mode, redirect to a signed URL from the clip-thumbnails bucket.
  if (process.env.STORAGE_BACKEND === "supabase") {
    const { data, error } = await serverClient()
      .storage.from("clip-thumbnails")
      .createSignedUrl(clip.thumbnail, 86400);
    if (error || !data) return new Response("Not found", { status: 404 });
    return Response.redirect(data.signedUrl, 302);
  }

  if (!existsSync(clip.thumbnail)) {
    return new Response("Not found", { status: 404 });
  }
  const buf = readFileSync(clip.thumbnail);
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
  });
}
