import { existsSync, statSync, createReadStream } from "fs";
import path from "path";
import os from "os";
import { serverClient } from "@/lib/db/client";
import { persistentSourcePath } from "@/lib/clip/store";
import type { ReadStream } from "fs";

export const dynamic = "force-dynamic";

function sourcePath(jobId: string): string {
  const persistent = persistentSourcePath(jobId);
  if (existsSync(persistent)) return persistent;
  return path.join(os.tmpdir(), "social-clipper", jobId, "source.mp4");
}

/** Serve the full source video for a job (the editor seeks into it), with range support. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  if (!/^[a-zA-Z0-9-]+$/.test(jobId)) {
    return new Response("Invalid jobId", { status: 400 });
  }

  // In supabase mode, redirect to a signed URL from the clip-sources bucket.
  if (process.env.STORAGE_BACKEND === "supabase") {
    const { data, error } = await serverClient()
      .storage.from("clip-sources")
      .createSignedUrl(`${jobId}.mp4`, 3600);
    if (error || !data) {
      return new Response("Source video not available.", { status: 404 });
    }
    return Response.redirect(data.signedUrl, 302);
  }

  const file = sourcePath(jobId);
  if (!existsSync(file)) {
    return new Response("Source video not available (temp file may have been cleared).", {
      status: 404,
    });
  }

  const stat = statSync(file);
  const range = req.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
    const stream = createReadStream(file, { start, end });
    return new Response(toWeb(stream), {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new Response(toWeb(createReadStream(file)), {
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
      stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
}
