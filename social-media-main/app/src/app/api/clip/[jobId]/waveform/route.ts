import { ensureWaveform } from "@/lib/clip/waveform";

export const dynamic = "force-dynamic";

// Job-level audio waveform peaks (amplitude envelope) for the timeline.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  try {
    const peaks = await ensureWaveform(jobId);
    return Response.json({ peaks });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Waveform unavailable", { status: 404 });
  }
}
