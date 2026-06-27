import { supabaseServer } from "@/lib/supabase";
import type { StorageObject } from "@/lib/db/types";

export const storageObjectRepository = {
  async findByChecksum(checksum: string): Promise<StorageObject | null> {
    const { data } = await supabaseServer
      .from("pub_storage_objects")
      .select("*")
      .eq("checksum", checksum)
      .eq("is_current", true)
      .limit(1)
      .single();
    return data ?? null;
  },

  async findById(id: string): Promise<StorageObject | null> {
    const { data } = await supabaseServer
      .from("pub_storage_objects")
      .select("*")
      .eq("id", id)
      .single();
    return data ?? null;
  },

  async findByIds(ids: string[]): Promise<StorageObject[]> {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) return [];
    const { data, error } = await supabaseServer
      .from("pub_storage_objects")
      .select("*")
      .in("id", uniqueIds);
    if (error) throw new Error(`storageObjectRepository.findByIds: ${error.message}`);
    return data ?? [];
  },

  async create(
    input: Omit<StorageObject, "id" | "created_at" | "deleted_at" | "version" | "is_current">
  ): Promise<StorageObject> {
    const { data, error } = await supabaseServer
      .from("pub_storage_objects")
      .insert(input)
      .select()
      .single();
    if (error) throw new Error(`storageObjectRepository.create: ${error.message}`);
    return data;
  },

  async markDeleted(id: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_storage_objects")
      .update({ deleted_at: new Date().toISOString(), is_current: false })
      .eq("id", id);
    if (error) throw new Error(`storageObjectRepository.markDeleted: ${error.message}`);
  },
};
