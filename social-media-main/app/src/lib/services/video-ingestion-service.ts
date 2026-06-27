import { createHash } from "crypto";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { v4 as uuid } from "uuid";
import { getStorageProvider } from "@/lib/storage";
import { storageObjectRepository, videoRepository } from "@/lib/db/repositories";

export interface IngestInput {
  tempVideoPath: string;
  tempThumbPath: string | null;
  meta: {
    title: string;
    creator: string;
    platform: "youtube" | "instagram" | "unknown";
    durationSec: number;
    originalUrl: string;
  };
}

export interface IngestResult {
  videoId: string;
  isDuplicate: boolean;
}

/**
 * Ingests a downloaded video into the Video Library.
 * 1. Computes SHA-256 checksum
 * 2. Checks for duplicate (same checksum in storage_objects)
 * 3. If duplicate: deletes temp files, returns existing video ID
 * 4. If new: uploads to R2, inserts storage_objects + videos rows, deletes temp files
 */
export async function ingestVideo(input: IngestInput): Promise<IngestResult> {
  const { tempVideoPath, tempThumbPath, meta } = input;
  const storage = getStorageProvider();

  const videoBuffer = readFileSync(tempVideoPath);
  const checksum = createHash("sha256").update(videoBuffer).digest("hex");

  const existing = await storageObjectRepository.findByChecksum(checksum);
  if (existing) {
    const existingVideo = await videoRepository.findByStorageObjectId(existing.id);
    cleanupTempFiles(tempVideoPath, tempThumbPath);
    return { videoId: existingVideo?.id ?? existing.id, isDuplicate: true };
  }

  const videoId = uuid();
  const videoKey = `videos/${videoId}.mp4`;

  try {
    await storage.upload(videoKey, videoBuffer, { mimeType: "video/mp4" });
    cleanupTempFiles(tempVideoPath, null);

    const storageObj = await storageObjectRepository.create({
      provider: "r2",
      bucket: process.env.R2_BUCKET_NAME!,
      key: videoKey,
      mime_type: "video/mp4",
      size_bytes: videoBuffer.length,
      checksum,
    });

    let thumbObjectId: string | null = null;
    if (tempThumbPath && existsSync(tempThumbPath)) {
      try {
        const thumbBuffer = readFileSync(tempThumbPath);
        const thumbKey = `thumbnails/${videoId}.jpg`;
        await storage.upload(thumbKey, thumbBuffer, { mimeType: "image/jpeg" });
        cleanupTempFiles(tempThumbPath, null);

        const thumbObj = await storageObjectRepository.create({
          provider: "r2",
          bucket: process.env.R2_BUCKET_NAME!,
          key: thumbKey,
          mime_type: "image/jpeg",
          size_bytes: thumbBuffer.length,
          checksum: createHash("sha256").update(thumbBuffer).digest("hex"),
        });
        thumbObjectId = thumbObj.id;
      } catch (thumbErr) {
        console.warn("[Ingest] Thumbnail upload failed (non-fatal):", thumbErr);
        try { if (tempThumbPath) unlinkSync(tempThumbPath); } catch {}
      }
    }

    const video = await videoRepository.create({
      id: videoId,
      storage_object_id: storageObj.id,
      thumbnail_object_id: thumbObjectId,
      title: meta.title,
      creator: meta.creator,
      platform: meta.platform,
      duration_sec: meta.durationSec,
      original_url: meta.originalUrl,
      storage_status: "available",
      publish_status: "unpublished",
    });

    return { videoId: video.id, isDuplicate: false };

  } catch (err) {
    cleanupTempFiles(tempVideoPath, tempThumbPath);
    throw err;
  }
}

function cleanupTempFiles(videoPath: string | null, thumbPath: string | null) {
  if (videoPath) try { if (existsSync(videoPath)) unlinkSync(videoPath); } catch {}
  if (thumbPath) try { if (existsSync(thumbPath)) unlinkSync(thumbPath); } catch {}
}
