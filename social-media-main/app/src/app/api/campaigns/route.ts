import { campaignService } from "@/lib/services/campaign-service";

export async function GET() {
  const campaigns = await campaignService.listAll();
  return Response.json(campaigns);
}

export async function POST(req: Request) {
  const body = await req.json();
  const campaign = await campaignService.create({
    name: body.name,
    captionPromptTemplate: body.captionPromptTemplate,
    scheduleRule: body.scheduleRule,
    timezone: body.timezone ?? body.scheduleRule?.timezone ?? "UTC",
    startsAt: body.startsAt,
  });
  return Response.json(campaign, { status: 201 });
}
