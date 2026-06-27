import { campaignRepository, videoRepository } from "@/lib/db/repositories";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cvs = await campaignRepository.getVideos(id);
  // Enrich with video metadata
  const enriched = await Promise.all(
    cvs.map(async (cv) => {
      const video = await videoRepository.findById(cv.video_id);
      return { ...cv, video };
    })
  );
  return Response.json(enriched);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { videoId, position } = await req.json();
  await campaignRepository.addVideo(id, videoId, position ?? 0);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { videoId } = await req.json();
  await campaignRepository.removeVideo(id, videoId);
  return Response.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orderedVideoIds } = await req.json();
  await campaignRepository.reorderVideos(id, orderedVideoIds);
  return Response.json({ ok: true });
}
