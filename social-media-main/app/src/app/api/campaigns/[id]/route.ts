import { campaignService } from "@/lib/services/campaign-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await campaignService.getById(id);
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(campaign);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const campaign = await campaignService.update(id, body);
  return Response.json(campaign);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await campaignService.delete(id);
  return Response.json({ ok: true });
}
