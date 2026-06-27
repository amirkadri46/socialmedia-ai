import { supabaseServer } from "@/lib/supabase";
import type { VideoCaption } from "@/lib/db/types";

export const videoCaptionRepository = {
  async findByVideo(videoId: string, platform?: string): Promise<VideoCaption[]> {
    let q = supabaseServer
      .from("pub_video_captions")
      .select("*")
      .eq("video_id", videoId);
    if (platform) q = q.eq("platform", platform);
    const { data, error } = await q;
    if (error) throw new Error(`videoCaptionRepository.findByVideo: ${error.message}`);
    return data ?? [];
  },

  async upsert(data: Omit<VideoCaption, "id" | "created_at">): Promise<VideoCaption> {
    const { data: row, error } = await supabaseServer
      .from("pub_video_captions")
      .upsert(data, { onConflict: "video_id,platform,language" })
      .select()
      .single();
    if (error) throw new Error(`videoCaptionRepository.upsert: ${error.message}`);
    return row;
  },

  async delete(videoId: string, platform: string): Promise<void> {
    const { error } = await supabaseServer
      .from("pub_video_captions")
      .delete()
      .eq("video_id", videoId)
      .eq("platform", platform);
    if (error) throw new Error(`videoCaptionRepository.delete: ${error.message}`);
  },
};
