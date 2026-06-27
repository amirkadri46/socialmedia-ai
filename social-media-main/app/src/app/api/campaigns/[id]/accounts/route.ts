import { campaignRepository, accountRepository } from "@/lib/db/repositories";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountIds = await campaignRepository.getAccounts(id);
  const accounts = await Promise.all(accountIds.map((aid) => accountRepository.findById(aid)));
  return Response.json(accounts.filter(Boolean));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accountId } = await req.json();
  await campaignRepository.addAccount(id, accountId);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accountId } = await req.json();
  await campaignRepository.removeAccount(id, accountId);
  return Response.json({ ok: true });
}
