import { campaignRepository, videoRepository } from "@/lib/db/repositories";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cvs = await campaignRepository.getVideos(id);
  const videos = await videoRepository.findByIds(cvs.map((cv) => cv.video_id));
  const videoById = new Map(videos.map((video) => [video.id, video]));
  const enriched = cvs.map((cv) => ({ ...cv, video: videoById.get(cv.video_id) ?? null }));
  return Response.json(enriched);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { videoId, position } = await req.json().catch(() => ({}));
  if (typeof videoId !== "string" || !videoId) {
    return Response.json({ error: "videoId is required." }, { status: 400 });
  }
  await campaignRepository.addVideo(id, videoId, typeof position === "number" ? position : 0);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { videoId } = await req.json().catch(() => ({}));
  if (typeof videoId !== "string" || !videoId) {
    return Response.json({ error: "videoId is required." }, { status: 400 });
  }
  await campaignRepository.removeVideo(id, videoId);
  return Response.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orderedVideoIds } = await req.json().catch(() => ({}));
  if (!Array.isArray(orderedVideoIds) || !orderedVideoIds.every((v) => typeof v === "string")) {
    return Response.json({ error: "orderedVideoIds must be an array of strings." }, { status: 400 });
  }
  await campaignRepository.reorderVideos(id, orderedVideoIds);
  return Response.json({ ok: true });
}
