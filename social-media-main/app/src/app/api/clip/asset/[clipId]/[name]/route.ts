import { existsSync, statSync, createReadStream, readFileSync } from "fs";
import path from "path";
import { clipAssetsDir } from "@/lib/clip/store";
import { serverClient } from "@/lib/db/client";
import type { ReadStream } from "fs";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg",
};

/** Serve an uploaded editor asset, with range support for audio/video. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ clipId: string; name: string }> }
) {
  const { clipId, name } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(clipId) || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    return new Response("Bad request", { status: 400 });
  }

  // In supabase mode, redirect to a signed URL from the clip-assets bucket.
  if (process.env.STORAGE_BACKEND === "supabase") {
    const { data, error } = await serverClient()
      .storage.from("clip-assets")
      .createSignedUrl(`${clipId}/${name}`, 3600);
    if (error || !data) return new Response("Not found", { status: 404 });
    return Response.redirect(data.signedUrl, 302);
  }

  const file = path.join(clipAssetsDir(clipId), name);
  if (!existsSync(file)) return new Response("Not found", { status: 404 });

  const ext = (name.split(".").pop() || "").toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const stat = statSync(file);
  const range = req.headers.get("range");

  if (range && (type.startsWith("video") || type.startsWith("audio"))) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    return new Response(toWeb(createReadStream(file, { start, end })), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const buf = readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": type, "Content-Length": String(buf.length) },
  });
}

function toWeb(stream: ReadStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (c) => controller.enqueue(new Uint8Array(c as Buffer)));
      stream.on("end", () => controller.close());
      stream.on("error", (e) => controller.error(e));
    },
    cancel() {
      stream.destroy();
    },
  });
}
