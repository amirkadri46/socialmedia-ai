import { existsSync, statSync, createReadStream } from "fs";
import path from "path";
import { repos } from "@/lib/db";
import { serverClient } from "@/lib/db/client";
import type { ReadStream } from "fs";

export const dynamic = "force-dynamic";

/**
 * Serve a rendered clip as a file download (attachment).
 *
 * Streams the file (matching the inline `media` route) instead of buffering the whole mp4
 * into memory, with `Accept-Ranges` + range support so download managers / players can
 * resume. A missing OR zero-length file returns a real HTTP error rather than a 0-byte (or
 * HTML-error) body that a browser would happily save as a broken ".mp4".
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const { clipId } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(clipId)) {
    return new Response("Bad request", { status: 400 });
  }

  const clip = await repos.clips.get(clipId);
  if (!clip || !clip.filePath) {
    return new Response("Not found", { status: 404 });
  }

  // In supabase mode, redirect to a signed download URL.
  if (process.env.STORAGE_BACKEND === "supabase") {
    const safeName =
      (clip.title || "clip").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50) + ".mp4";
    const { data, error } = await serverClient()
      .storage.from("clips")
      .createSignedUrl(clip.filePath, 3600, { download: safeName });
    if (error || !data) return new Response("Not found", { status: 404 });
    return Response.redirect(data.signedUrl, 302);
  }

  if (!existsSync(clip.filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = statSync(clip.filePath);
  if (stat.size === 0) {
    // An empty file means a render failed/was interrupted mid-write — never hand the client
    // a 0-byte attachment that looks like a successful download.
    return new Response("Clip file is empty or still rendering", { status: 409 });
  }

  const safeName =
    (clip.title || "clip").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50) +
    path.extname(clip.filePath);
  const disposition = `attachment; filename="${safeName}"`;
  const range = req.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    const startByte = match ? parseInt(match[1], 10) : 0;
    const endByte = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
    const chunkSize = endByte - startByte + 1;
    const nodeStream = createReadStream(clip.filePath, { start: startByte, end: endByte });
    return new Response(toWeb(nodeStream), {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": disposition,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${startByte}-${endByte}/${stat.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(toWeb(createReadStream(clip.filePath)), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": disposition,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    },
  });
}

function toWeb(stream: ReadStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) =>
        controller.enqueue(new Uint8Array(chunk as Buffer))
      );
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
}
