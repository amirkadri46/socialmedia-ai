import { campaignService } from "@/lib/services/campaign-service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await campaignService.publish(id);
    return Response.json({ ok: true });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : "Publish failed" }, { status: 400 });
  }
}
