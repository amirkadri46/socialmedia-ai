import { campaignService } from "@/lib/services/campaign-service";
import type { Campaign, CampaignStatus } from "@/lib/db/types";

const CAMPAIGN_STATUSES = new Set<CampaignStatus>([
  "draft",
  "ready",
  "scheduled",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await campaignService.getById(id);
  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(campaign);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Partial<Campaign>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  const patch: Partial<Campaign> = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.caption_prompt_template === "string" || body.caption_prompt_template === null) {
    patch.caption_prompt_template = body.caption_prompt_template;
  }
  if (body.assignment_mode === "crosspost" || body.assignment_mode === "distribute") patch.assignment_mode = body.assignment_mode;
  if (body.schedule_rule && typeof body.schedule_rule === "object") patch.schedule_rule = body.schedule_rule;
  if (typeof body.timezone === "string") patch.timezone = body.timezone;
  if (typeof body.starts_at === "string" || body.starts_at === null) patch.starts_at = body.starts_at;
  if (body.status && CAMPAIGN_STATUSES.has(body.status)) patch.status = body.status;

  try {
    const campaign = await campaignService.update(id, patch);
    return Response.json(campaign);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update campaign.";
    return Response.json({ error: message }, { status: message.includes("not found") ? 404 : 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await campaignService.delete(id);
  return Response.json({ ok: true });
}
