import { campaignRepository, accountRepository } from "@/lib/db/repositories";
import { repos } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountIds = await campaignRepository.getAccounts(id);
  const accounts = await accountRepository.findByIds(accountIds);
  return Response.json(accounts);
}

// Bridge: account IDs from /api/accounts come from social-accounts.json (clip pipeline).
// pub_campaign_accounts requires a FK into pub_instagram_accounts, so we upsert there first.
async function resolveToPublishingAccountId(accountId: string): Promise<string> {
  const existing = await accountRepository.findById(accountId);
  if (existing) return existing.id;

  const all = await repos.socialAccounts.getAll();
  const sa = all.find((a) => a.id === accountId);
  if (!sa?.igUserId) throw new Error(`Account ${accountId} not found`);

  const upserted = await accountRepository.upsert({
    ig_user_id: sa.igUserId,
    username: sa.username,
    display_name: sa.displayName ?? null,
    access_token: sa.accessToken,
    token_expires_at: sa.expiresAt ?? null,
    status: "connected",
    last_posted_at: null,
  });
  return upserted.id;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accountId } = await req.json().catch(() => ({}));
  if (typeof accountId !== "string" || !accountId) {
    return Response.json({ error: "accountId is required." }, { status: 400 });
  }
  const pubAccountId = await resolveToPublishingAccountId(accountId);
  await campaignRepository.addAccount(id, pubAccountId);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { accountId } = await req.json().catch(() => ({}));
  if (typeof accountId !== "string" || !accountId) {
    return Response.json({ error: "accountId is required." }, { status: 400 });
  }
  await campaignRepository.removeAccount(id, accountId);
  return Response.json({ ok: true });
}
