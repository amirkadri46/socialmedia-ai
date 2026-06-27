import { uploadJobRepository } from "@/lib/db/repositories";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;
  const { rows, total } = await uploadJobRepository.findWithFilters({
    campaign_id: p.get("campaign_id") ?? undefined,
    account_id: p.get("account_id") ?? undefined,
    status: p.get("status") ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    limit: p.get("limit") ? Number(p.get("limit")) : 50,
    offset: p.get("offset") ? Number(p.get("offset")) : 0,
  });
  return Response.json({ jobs: rows, total });
}
