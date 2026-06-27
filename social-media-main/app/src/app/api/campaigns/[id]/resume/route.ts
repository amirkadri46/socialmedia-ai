import { campaignService } from "@/lib/services/campaign-service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await campaignService.resume(id);
  return Response.json({ ok: true });
}
