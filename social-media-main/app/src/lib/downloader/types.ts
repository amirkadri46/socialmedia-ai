export type DownloadStatus =
  | "waiting"
  | "inspecting"
  | "downloading"
  | "uploading"
  | "completed"
  | "failed"
  | "retrying"
  | "paused"
  | "cancelled";

export type DownloadPlatform = "youtube" | "instagram" | "unknown";
export type DownloadQuality = "best" | "1080p" | "720p";

export interface DownloadJob {
  id: string;
  url: string;
  platform: DownloadPlatform;
  creator: string;      // populated after inspect
  title: string;        // populated after inspect
  thumbnail: string;    // populated after inspect
  quality: DownloadQuality;
  status: DownloadStatus;
  progress: number;     // 0–100
  speed: string;        // "1.2 MB/s" or ""
  eta: string;          // "00:02" or ""
  error: string;
  retryCount: number;
  videoLibraryId: string;  // Supabase videos.id, set after successful ingestion
  ingestError: string;     // set if ingestion fails after download succeeds
  addedAt: string;         // ISO timestamp
}

export interface DownloaderSettings {
  quality: DownloadQuality;
  concurrentDownloads: number;
  retryCount: number;
  skipDuplicates: boolean;
}

export const DEFAULT_DOWNLOADER_SETTINGS: DownloaderSettings = {
  quality: "best",
  concurrentDownloads: 3,
  retryCount: 3,
  skipDuplicates: true,
};
