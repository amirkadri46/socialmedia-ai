import { videoRepository, storageObjectRepository, videoCaptionRepository } from "@/lib/db/repositories";
import { getStorageProvider } from "@/lib/storage";
import type { VideoFilters } from "@/lib/db/repositories/video-repository";

export interface VideoWithUrls {
  id: string;
  title: string;
  creator: string | null;
  platform: string | null;
  duration_sec: number | null;
  publish_status: string;
  storage_status: string;
  downloaded_at: string;
  thumbnail_url: string | null;
}

export interface VideoDetail extends VideoWithUrls {
  video_url: string;
  captions: { platform: string; language: string; caption: string }[];
}

export const videoLibraryService = {
  async listVideos(filters?: VideoFilters): Promise<VideoWithUrls[]> {
    const storage = getStorageProvider();
    const videos = await videoRepository.findAll(filters);

    return Promise.all(
      videos.map(async (v) => {
        let thumbnail_url: string | null = null;
        if (v.thumbnail_object_id) {
          const thumbObj = await storageObjectRepository.findById(v.thumbnail_object_id);
          if (thumbObj?.key) thumbnail_url = await storage.getSignedUrl(thumbObj.key, 3600);
        }
        return {
          id: v.id,
          title: v.title,
          creator: v.creator,
          platform: v.platform,
          duration_sec: v.duration_sec,
          publish_status: v.publish_status,
          storage_status: v.storage_status,
          downloaded_at: v.downloaded_at,
          thumbnail_url,
        };
      })
    );
  },

  async getVideoDetail(id: string): Promise<VideoDetail | null> {
    const storage = getStorageProvider();
    const video = await videoRepository.findById(id);
    if (!video) return null;

    let thumbnail_url: string | null = null;
    let video_url = "";

    if (video.thumbnail_object_id) {
      const thumbObj = await storageObjectRepository.findById(video.thumbnail_object_id);
      if (thumbObj?.key) thumbnail_url = await storage.getSignedUrl(thumbObj.key, 3600);
    }

    if (video.storage_object_id) {
      const vidObj = await storageObjectRepository.findById(video.storage_object_id);
      if (vidObj?.key) video_url = await storage.getSignedUrl(vidObj.key, 21600);
    }

    const captions = await videoCaptionRepository.findByVideo(id);

    return {
      id: video.id,
      title: video.title,
      creator: video.creator,
      platform: video.platform,
      duration_sec: video.duration_sec,
      publish_status: video.publish_status,
      storage_status: video.storage_status,
      downloaded_at: video.downloaded_at,
      thumbnail_url,
      video_url,
      captions: captions.map((c) => ({ platform: c.platform, language: c.language, caption: c.caption })),
    };
  },

  async deleteVideo(id: string): Promise<void> {
    const storage = getStorageProvider();
    const video = await videoRepository.findById(id);
    if (!video) return;

    if (video.storage_object_id) {
      const obj = await storageObjectRepository.findById(video.storage_object_id);
      if (obj) {
        await storage.delete(obj.key);
        await storageObjectRepository.markDeleted(obj.id);
      }
    }
    if (video.thumbnail_object_id) {
      const obj = await storageObjectRepository.findById(video.thumbnail_object_id);
      if (obj) {
        await storage.delete(obj.key);
        await storageObjectRepository.markDeleted(obj.id);
      }
    }

    await videoRepository.delete(id);
  },
};
