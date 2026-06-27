import { videoLibraryService } from "@/lib/services/video-library-service";
import { videoRepository } from "@/lib/db/repositories";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const video = await videoLibraryService.getVideoDetail(id);
  if (!video) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(video);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await videoLibraryService.deleteVideo(id);
  return Response.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const allowed = { title: body.title, creator: body.creator };
  await videoRepository.update(id, allowed);
  return Response.json({ ok: true });
}
