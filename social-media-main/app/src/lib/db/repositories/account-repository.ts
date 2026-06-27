import { supabaseServer } from "@/lib/supabase";
import type { AccountStatus, InstagramAccount } from "@/lib/db/types";

export const accountRepository = {
  async findAll(status?: AccountStatus): Promise<InstagramAccount[]> {
    let q = supabaseServer.from("pub_instagram_accounts").select("*");
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw new Error(`accountRepository.findAll: ${error.message}`);
    return data ?? [];
  },

  async findById(id: string): Promise<InstagramAccount | null> {
    const { data } = await supabaseServer
      .from("pub_instagram_accounts")
      .select("*")
      .eq("id", id)
      .single();
    return data ?? null;
  },

  async findByIds(ids: string[]): Promise<InstagramAccount[]> {
    if (ids.length === 0) return [];
    const { data, error } = await supabaseServer
      .from("pub_instagram_accounts")
      .select("*")
      .in("id", ids);
    if (error) throw new Error(`accountRepository.findByIds: ${error.message}`);
    return data ?? [];
  },

  async findByIgUserId(igUserId: string): Promise<InstagramAccount | null> {
    const { data } = await supabaseServer
      .from("pub_instagram_accounts")
      .select("*")
      .eq("ig_user_id", igUserId)
      .single();
    return data ?? null;
  },

  async upsert(data: Omit<InstagramAccount, "id" | "created_at">): Promise<InstagramAccount> {
    const { data: row, error } = await supabaseServer
      .from("pub_instagram_accounts")
      .upsert(data, { onConflict: "ig_user_id" })
      .select()
      .single();
    if (error) throw new Error(`accountRepository.upsert: ${error.message}`);
    return row;
  },

  async update(id: string, data: Partial<InstagramAccount>): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_instagram_accounts")
      .update(data)
      .eq("id", id);
    if (error) throw new Error(`accountRepository.update: ${error.message}`);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_instagram_accounts")
      .delete()
      .eq("id", id);
    if (error) throw new Error(`accountRepository.delete: ${error.message}`);
  },
};
