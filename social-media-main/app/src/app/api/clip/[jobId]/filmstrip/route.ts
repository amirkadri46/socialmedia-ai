import { existsSync, statSync, createReadStream } from "fs";
import type { ReadStream } from "fs";
import { ensureFilmstrip } from "@/lib/clip/filmstrip";

export const dynamic = "force-dynamic";

// Job-level filmstrip: GET?meta=1 → geometry JSON; GET → image/jpeg sprite sheet.
// Served directly from disk (the clipId-keyed asset route doesn't apply here).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const url = new URL(req.url);

  let meta;
  try {
    meta = await ensureFilmstrip(jobId);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Filmstrip unavailable", { status: 404 });
  }

  if (url.searchParams.get("meta")) {
    return Response.json({
      frameCount: meta.frameCount,
      frameW: meta.frameW,
      frameH: meta.frameH,
      intervalSec: meta.intervalSec,
      sourceDurationSec: meta.sourceDurationSec,
      sourceFps: meta.sourceFps,
    });
  }

  const file = meta.spritePath;
  if (!existsSync(file)) {
    return new Response("Sprite not available", { status: 404 });
  }
  const stat = statSync(file);
  return new Response(toWeb(createReadStream(file)), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=3600",
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
