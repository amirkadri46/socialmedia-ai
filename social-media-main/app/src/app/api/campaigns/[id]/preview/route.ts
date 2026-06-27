import { campaignService } from "@/lib/services/campaign-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const preview = await campaignService.getPreview(id);
    return Response.json(preview);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 404 });
  }
}
