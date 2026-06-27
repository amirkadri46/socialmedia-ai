import { exportEdit } from "@/lib/clip/editRender";
import { repos } from "@/lib/db";

export const maxDuration = 300;

/** Render the saved ClipEdit into a final mp4, streaming progress over SSE. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ jobId: string; clipId: string }> }
) {
  const { jobId, clipId } = await params;
  const [clip, job, words] = await Promise.all([
    repos.clips.get(clipId),
    repos.clipJobs.get(jobId),
    repos.clipTranscripts.get(jobId),
  ]);
  if (!clip || !job) return new Response("Clip not found", { status: 404 });

  const edit = (await repos.clipEdits.get(clipId)) ?? repos.clipEdits.getDefault(clip, job);

  const encoder = new TextEncoder();
  let gone = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          gone = true;
        }
      };
      try {
        await exportEdit(edit, words ?? [], (p) => send(p));
      } catch (err) {
        send({ percent: 0, log: err instanceof Error ? err.message : "Export failed" });
      } finally {
        try { controller.close(); } catch { /* closed */ }
      }
    },
    cancel() {
      gone = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
