import { supabaseServer } from "@/lib/supabase";
import type { StorageStatus, PublishStatus, Video } from "@/lib/db/types";

export interface VideoFilters {
  platform?: string;
  storage_status?: StorageStatus;
  publish_status?: PublishStatus;
  creator?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export const videoRepository = {
  async findAll(filters: VideoFilters = {}): Promise<Video[]> {
    let q = supabaseServer.from("pub_videos").select("*");
    if (filters.platform) q = q.eq("platform", filters.platform);
    if (filters.storage_status) q = q.eq("storage_status", filters.storage_status);
    if (filters.publish_status) q = q.eq("publish_status", filters.publish_status);
    if (filters.creator) q = q.eq("creator", filters.creator);
    if (filters.search) q = q.ilike("title", `%${filters.search}%`);
    q = q.limit(filters.limit ?? 50);
    if (filters.offset) q = q.range(filters.offset, filters.offset + (filters.limit ?? 50) - 1);
    const { data, error } = await q;
    if (error) throw new Error(`videoRepository.findAll: ${error.message}`);
    return data ?? [];
  },

  async findById(id: string): Promise<Video | null> {
    const { data } = await supabaseServer
      .from("pub_videos")
      .select("*")
      .eq("id", id)
      .single();
    return data ?? null;
  },

  async findByIds(ids: string[]): Promise<Video[]> {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0) return [];
    const { data, error } = await supabaseServer
      .from("pub_videos")
      .select("*")
      .in("id", uniqueIds);
    if (error) throw new Error(`videoRepository.findByIds: ${error.message}`);
    return data ?? [];
  },

  async findByChecksum(checksum: string): Promise<{ videoId: string } | null> {
    const { data } = await supabaseServer
      .from("pub_videos")
      .select("id, pub_storage_objects!storage_object_id(checksum)")
      .eq("pub_storage_objects.checksum", checksum)
      .eq("storage_status", "available")
      .limit(1)
      .single();
    if (!data) return null;
    return { videoId: (data as { id: string }).id };
  },

  async create(data: Omit<Video, "downloaded_at">): Promise<Video> {
    const { data: row, error } = await supabaseServer
      .from("pub_videos")
      .insert(data)
      .select()
      .single();
    if (error) throw new Error(`videoRepository.create: ${error.message}`);
    return row;
  },

  async update(
    id: string,
    data: Partial<Pick<Video, "storage_status" | "publish_status" | "title" | "creator">>
  ): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_videos")
      .update(data)
      .eq("id", id);
    if (error) throw new Error(`videoRepository.update: ${error.message}`);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_videos")
      .update({ storage_status: "deleted" })
      .eq("id", id);
    if (error) throw new Error(`videoRepository.delete: ${error.message}`);
  },

  async findByStorageObjectId(storageObjectId: string): Promise<Video | null> {
    const { data } = await supabaseServer
      .from("pub_videos")
      .select("*")
      .eq("storage_object_id", storageObjectId)
      .limit(1)
      .single();
    return data ?? null;
  },

  async countAll(filters: Omit<VideoFilters, "limit" | "offset"> = {}): Promise<number> {
    let q = supabaseServer.from("pub_videos").select("*", { count: "exact", head: true });
    if (filters.platform) q = q.eq("platform", filters.platform);
    if (filters.storage_status) q = q.eq("storage_status", filters.storage_status);
    if (filters.publish_status) q = q.eq("publish_status", filters.publish_status);
    if (filters.creator) q = q.eq("creator", filters.creator);
    if (filters.search) q = q.ilike("title", `%${filters.search}%`);
    const { count, error } = await q;
    if (error) throw new Error(`videoRepository.countAll: ${error.message}`);
    return count ?? 0;
  },
};
