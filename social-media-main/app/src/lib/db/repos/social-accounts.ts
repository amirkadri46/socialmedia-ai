import type { SocialAccount } from "@/lib/types";
import {
  readAccounts,
  writeAccounts,
  upsertAccount as fileUpsertAccount,
  publicAccounts as filePublicAccounts,
} from "@/lib/clip/store";
import { serverClient } from "../client";

export interface SocialAccountsRepo {
  getAll(): Promise<SocialAccount[]>;
  upsert(account: SocialAccount): Promise<void>;
  delete(id: string): Promise<void>;
  public(): Promise<Omit<SocialAccount, "accessToken">[]>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileSocialAccounts: SocialAccountsRepo = {
  async getAll() { return readAccounts(); },
  async upsert(account) { fileUpsertAccount(account); },
  async delete(id) { writeAccounts(readAccounts().filter((a) => a.id !== id)); },
  async public() { return filePublicAccounts(); },
};

// ── Supabase backend ─────────────────────────────────────────────────────────

function fromRow(r: Record<string, unknown>): SocialAccount {
  return {
    id: r.id as string,
    platform: r.platform as SocialAccount["platform"],
    displayName: r.display_name as string,
    username: r.username as string,
    avatarUrl: r.avatar_url as string | undefined,
    accessToken: r.access_token as string,
    igUserId: r.ig_user_id as string | undefined,
    pageId: r.page_id as string | undefined,
    expiresAt: r.expires_at as string | undefined,
    connectedAt: r.connected_at as string,
  };
}

function toRow(a: SocialAccount) {
  return {
    id: a.id,
    platform: a.platform,
    display_name: a.displayName,
    username: a.username,
    avatar_url: a.avatarUrl ?? null,
    access_token: a.accessToken,
    ig_user_id: a.igUserId ?? null,
    page_id: a.pageId ?? null,
    expires_at: a.expiresAt ?? null,
    connected_at: a.connectedAt,
  };
}

export const supabaseSocialAccounts: SocialAccountsRepo = {
  async getAll() {
    const { data, error } = await serverClient()
      .from("social_accounts")
      .select("*")
      .order("connected_at");
    if (error) throw error;
    return (data ?? []).map(fromRow);
  },
  async upsert(account) {
    // Upsert: if igUserId matches an existing row, update it preserving original id/connectedAt
    const db = serverClient();
    if (account.igUserId) {
      const { data: existing } = await db
        .from("social_accounts")
        .select("id, connected_at")
        .eq("ig_user_id", account.igUserId)
        .single();
      if (existing) {
        const row = toRow(account);
        row.id = (existing as Record<string, unknown>).id as string;
        row.connected_at = (existing as Record<string, unknown>).connected_at as string;
        const { error } = await db.from("social_accounts").update(row).eq("id", row.id);
        if (error) throw error;
        return;
      }
    }
    const { error } = await db.from("social_accounts").upsert(toRow(account), { onConflict: "id" });
    if (error) throw error;
  },
  async delete(id) {
    const { error } = await serverClient().from("social_accounts").delete().eq("id", id);
    if (error) throw error;
  },
  async public() {
    const all = await supabaseSocialAccounts.getAll();
    return all.map((account) => {
      const rest = { ...account };
      delete (rest as Partial<SocialAccount>).accessToken;
      return rest;
    });
  },
};
