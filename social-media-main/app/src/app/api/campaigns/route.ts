import { campaignService } from "@/lib/services/campaign-service";

export async function GET() {
  const campaigns = await campaignService.listAll();
  return Response.json(campaigns);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.name !== "string" || !body.name.trim()) {
      return Response.json({ error: "name is required." }, { status: 400 });
    }
    if (!body.scheduleRule || typeof body.scheduleRule !== "object") {
      return Response.json({ error: "scheduleRule is required." }, { status: 400 });
    }
    const campaign = await campaignService.create({
      name: body.name,
      captionPromptTemplate: typeof body.captionPromptTemplate === "string" ? body.captionPromptTemplate : undefined,
      scheduleRule: body.scheduleRule,
      timezone: typeof body.timezone === "string" ? body.timezone : body.scheduleRule.timezone ?? "UTC",
      startsAt: typeof body.startsAt === "string" ? body.startsAt : undefined,
    });
    return Response.json(campaign, { status: 201 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invalid request." }, { status: 400 });
  }
}
