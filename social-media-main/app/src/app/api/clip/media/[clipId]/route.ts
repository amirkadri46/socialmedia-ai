import { existsSync, statSync, createReadStream } from "fs";
import { repos } from "@/lib/db";
import { serverClient } from "@/lib/db/client";
import type { ReadStream } from "fs";

export const dynamic = "force-dynamic";

/** Serve a rendered clip inline (for <video> preview) with HTTP range support. */
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

  // In supabase mode, redirect to a short-lived signed URL from Storage.
  if (process.env.STORAGE_BACKEND === "supabase") {
    const { data, error } = await serverClient()
      .storage.from("clips")
      .createSignedUrl(clip.filePath, 3600);
    if (error || !data) return new Response("Not found", { status: 404 });
    return Response.redirect(data.signedUrl, 302);
  }

  if (!existsSync(clip.filePath)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = statSync(clip.filePath);
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
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${startByte}-${endByte}/${stat.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(toWeb(createReadStream(clip.filePath)), {
    headers: {
      "Content-Type": "video/mp4",
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
