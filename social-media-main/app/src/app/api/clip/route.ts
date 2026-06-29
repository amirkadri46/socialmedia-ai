import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { runClipPipeline, errMessage } from "@/lib/clip/clipPipeline";
import { repos } from "@/lib/db";
import type { ClipJob } from "@/lib/types";

export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(await repos.clipJobs.getAll());
}

function buildJob(partial: Partial<ClipJob>): ClipJob {
  return {
    id: partial.id || uuid(),
    sourceUrl: partial.sourceUrl,
    sourceTitle: partial.sourceTitle || "Untitled video",
    sourceDurationSec: partial.sourceDurationSec || 0,
    sourceThumbnail: partial.sourceThumbnail,
    status: "downloading",
    clipModel: partial.clipModel || "ClipBasic",
    genre: partial.genre || "Auto",
    clipLengthMode: partial.clipLengthMode || "Auto (0-3m)",
    autoHook: partial.autoHook ?? true,
    captionPreset: partial.captionPreset || "Karaoke",
    aspectRatio: partial.aspectRatio || "9:16",
    speechLanguage: partial.speechLanguage || "English",
    includeMomentsPrompt: partial.includeMomentsPrompt || "",
    rangeStartSec: partial.rangeStartSec ?? 0,
    rangeEndSec: partial.rangeEndSec ?? 0,
    topK: partial.topK || 6,
    createdAt: new Date().toISOString(),
    errors: [],
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  let job: ClipJob;
  let uploadBuffer: Buffer | undefined;
  let uploadExt: string | undefined;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const jobJson = form.get("job");
      const file = form.get("file");
      let partial: Partial<ClipJob> = {};
      if (jobJson) {
        try {
          partial = JSON.parse(String(jobJson)) as Partial<ClipJob>;
        } catch {
          return new Response(JSON.stringify({ error: "Invalid job JSON in form data." }), { status: 400 });
        }
      }
      job = buildJob(partial);
      if (file && typeof file !== "string") {
        const f = file as File;
        const MAX_SOURCE_BYTES = 500 * 1024 * 1024; // 500 MB
        if (f.size > MAX_SOURCE_BYTES) {
          return new Response(JSON.stringify({ error: "File too large (max 500 MB)." }), { status: 413 });
        }
        uploadBuffer = Buffer.from(await f.arrayBuffer());
        uploadExt = f.name.split(".").pop() || "mp4";
        if (!job.sourceTitle || job.sourceTitle === "Untitled video") {
          job.sourceTitle = f.name.replace(/\.[^.]+$/, "");
        }
      }
    } else {
      let partial: Partial<ClipJob>;
      try {
        partial = (await request.json()) as Partial<ClipJob>;
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON in request body." }), { status: 400 });
      }
      job = buildJob(partial);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Failed to parse request." }), { status: 400 });
  }

  const encoder = new TextEncoder();
  let clientGone = false;
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runClipPipeline({ job, uploadBuffer, uploadExt }, (progress) => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
          } catch {
            clientGone = true;
          }
        });
      } catch (err) {
        if (!clientGone) {
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  jobId: job.id,
                  status: "error",
                  percent: 0,
                  momentsTotal: 0,
                  clipsRendered: 0,
                  log: [],
                  errors: [errMessage(err)],
                })}\n\n`
              )
            );
          } catch { /* client gone */ }
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() { clientGone = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
