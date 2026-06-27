# Epic 3 — Video Ingestion (Downloader → R2 → Library)

## Objective

Connect the downloader to the Video Library. After yt-dlp finishes downloading a video, the app uploads it to R2, computes a SHA-256 checksum for deduplication, registers it in Supabase, and deletes the local temp file. The Video Library API routes expose this data. No UI in this epic.

## Prerequisites

- Epic 1 complete (repositories exist)
- Epic 2 complete (storage provider works)

## Scope

- `VideoIngestionService` — orchestrates hash → dedup → upload → register
- Update `lib/downloader/queue-runner.ts` to call ingestion after download
- Update `lib/downloader/engine.ts` to save to temp dir (not a user-facing folder)
- Update `lib/downloader/types.ts` — remove `outputPath`, `downloadDir`; add `videoLibraryId`
- Update `lib/downloader/store.ts` — remove `downloadDir` from settings
- Library API routes (backend only, no UI)
- `VideoLibraryService` — list, get, delete videos

## Out of Scope

- Video Library UI (Epic 4)
- Caption generation (Epic 4)
- Any campaign logic (Epic 5+)
- Worker (Epic 6)

---

## Step 1 — Update Downloader Types

Edit `app/src/lib/downloader/types.ts`.

**Remove** from `DownloadJob`:
```typescript
outputPath: string;
```

**Add** to `DownloadJob`:
```typescript
videoLibraryId: string;   // Supabase videos.id, set after successful ingestion
ingestError: string;      // set if ingestion fails after download succeeds
```

**Remove** from `DownloaderSettings`:
```typescript
downloadDir: string;
overwriteExisting: boolean;
```

**Remove** from `DEFAULT_DOWNLOADER_SETTINGS`:
```typescript
downloadDir: "D:\\downloaded videos",
overwriteExisting: false,
```

---

## Step 2 — Update Engine (temp dir output)

Edit `app/src/lib/downloader/engine.ts`.

The `downloadSingleJob()` function currently saves to a user-configured directory. Change it to save to a temp directory under OS temp:

```typescript
import os from "os";
import path from "path";
import { mkdirSync, existsSync } from "fs";

function getTempDir(jobId: string): string {
  const dir = path.join(os.tmpdir(), "social-dl", jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
```

The yt-dlp output template becomes:
```
{tempDir}/%(title)s.%(ext)s
```

The function returns `{ videoPath: string; thumbPath: string | null }` — the paths to the temp files. These are passed to `ingestVideo()` which uploads and then deletes them.

Remove the `qualityFormat` function's reference to `downloadDir`. Remove `overwriteExisting` from the function signature (no longer needed — deduplication is handled by checksum).

The yt-dlp args for thumbnail:
```
"--write-thumbnail",
"--convert-thumbnails", "jpg",
```

After yt-dlp completes, find the thumbnail file: look for a `.jpg` file in `tempDir` with the same base name as the video file.

---

## Step 3 — VideoIngestionService

Create `app/src/lib/services/video-ingestion-service.ts`:

```typescript
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

  // 1. Read file + compute checksum
  const videoBuffer = readFileSync(tempVideoPath);
  const checksum = createHash("sha256").update(videoBuffer).digest("hex");

  // 2. Deduplication check
  const existing = await storageObjectRepository.findByChecksum(checksum);
  if (existing) {
    // Find the video that owns this storage object
    const existingVideo = await videoRepository.findByStorageObjectId(existing.id);
    cleanupTempFiles(tempVideoPath, tempThumbPath);
    return { videoId: existingVideo?.id ?? existing.id, isDuplicate: true };
  }

  const videoId = uuid();
  const videoKey = `videos/${videoId}.mp4`;

  try {
    // 3. Upload video to R2
    await storage.upload(videoKey, videoBuffer, { mimeType: "video/mp4" });
    cleanupTempFiles(tempVideoPath, null); // delete video temp immediately

    // 4. Insert storage_object for video
    const storageObj = await storageObjectRepository.create({
      provider: "r2",
      bucket: process.env.R2_BUCKET_NAME!,
      key: videoKey,
      mime_type: "video/mp4",
      size_bytes: videoBuffer.length,
      checksum,
    });

    // 5. Upload thumbnail if available
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

    // 6. Insert video row
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
    // Cleanup temp files on any error
    cleanupTempFiles(tempVideoPath, tempThumbPath);
    throw err;
  }
}

function cleanupTempFiles(videoPath: string | null, thumbPath: string | null) {
  if (videoPath) try { if (existsSync(videoPath)) unlinkSync(videoPath); } catch {}
  if (thumbPath) try { if (existsSync(thumbPath)) unlinkSync(thumbPath); } catch {}
}
```

**Add to `videoRepository`** the method `findByStorageObjectId(storageObjectId: string): Promise<Video | null>`.

---

## Step 4 — Update Queue Runner

Edit `app/src/lib/downloader/queue-runner.ts`.

After `downloadSingleJob()` succeeds (yt-dlp finishes), call `ingestVideo()`:

```typescript
import { ingestVideo } from "@/lib/services/video-ingestion-service";

// Inside processJob(), after the download call:
try {
  const { videoPath, thumbPath } = await downloadSingleJob(job, quality, (p, s, e) => {
    this.patch(job.id, { progress: p, speed: s, eta: e });
  });

  this.patch(job.id, { status: "uploading", progress: 100 });

  const { videoId, isDuplicate } = await ingestVideo({
    tempVideoPath: videoPath,
    tempThumbPath: thumbPath,
    meta: {
      title: job.title || "Untitled",
      creator: job.creator || "Unknown",
      platform: job.platform === "youtube" ? "youtube"
               : job.platform === "instagram" ? "instagram"
               : "unknown",
      durationSec: 0,       // populated during inspect phase
      originalUrl: job.url,
    },
  });

  this.patch(job.id, {
    status: "completed",
    videoLibraryId: videoId,
    speed: "",
    eta: "",
    ...(isDuplicate ? { ingestError: "Duplicate — existing video reused" } : {}),
  });
  upsertJob(this.getJob(job.id)!);

} catch (err) {
  // Handle retry logic as before
}
```

Add `"uploading"` to the `DownloadStatus` union type if not already present.

---

## Step 5 — Update Downloader Settings

Edit `app/src/app/downloader/settings/page.tsx` (if it exists from the downloader plan). Remove the "Download directory" and "Overwrite existing files" fields. The page should only show:
- Quality
- Concurrent downloads
- Retry count
- Skip duplicates

Edit `app/src/lib/downloader/store.ts`. Remove `downloadDir` and `overwriteExisting` from `DownloaderSettings` and `DEFAULT_DOWNLOADER_SETTINGS`.

---

## Step 6 — VideoLibraryService

Create `app/src/lib/services/video-library-service.ts`:

```typescript
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
  thumbnail_url: string | null;   // 1-hour signed URL
}

export interface VideoDetail extends VideoWithUrls {
  video_url: string;              // 6-hour signed URL (for preview modal)
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
          if (thumbObj?.key) {
            thumbnail_url = await storage.getSignedUrl(thumbObj.key, 3600);
          }
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

    // Mark storage objects as deleted
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
```

---

## Step 7 — Library API Routes

### `app/src/app/api/library/route.ts`

```typescript
import { videoLibraryService } from "@/lib/services/video-library-service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters = {
    platform: searchParams.get("platform") ?? undefined,
    storage_status: searchParams.get("storage_status") as any ?? undefined,
    publish_status: searchParams.get("publish_status") as any ?? undefined,
    creator: searchParams.get("creator") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    limit: parseInt(searchParams.get("limit") ?? "50"),
    offset: parseInt(searchParams.get("offset") ?? "0"),
  };
  const videos = await videoLibraryService.listVideos(filters);
  return Response.json(videos);
}
```

### `app/src/app/api/library/[id]/route.ts`

- **GET** — calls `videoLibraryService.getVideoDetail(id)`, returns 404 if null
- **DELETE** — calls `videoLibraryService.deleteVideo(id)`, returns `{ ok: true }`
- **PATCH** — updates `title`, `creator` fields only. Calls `videoRepository.update(id, body)`.

### `app/src/app/api/library/[id]/caption/route.ts`

**GET** — return captions for this video:
```typescript
const captions = await videoCaptionRepository.findByVideo(id);
return Response.json(captions);
```

**POST** — generate and save a caption:

Body: `{ platform?: string; language?: string; promptTemplate?: string }`

Logic:
1. Fetch video metadata (`videoRepository.findById(id)`)
2. Build prompt: use `promptTemplate` from body, or fall back to the default: `"Write an engaging Instagram caption for a video titled '{title}' by {creator}. Include 5-10 relevant hashtags. Keep it authentic and under 150 words."`
3. Call the existing LLM client (`lib/llm-client.ts` or `lib/clip/llm.ts` — check which one exists and handles OpenAI/OpenRouter)
4. Save result via `videoCaptionRepository.upsert({ video_id: id, platform, language, caption: generatedText })`
5. Return `{ caption: generatedText }`

---

## Acceptance Criteria

Epic 3 is complete when ALL of the following are true:

- [ ] Download a YouTube Short via the downloader UI → status moves to `completed`
- [ ] The video appears in `videos` table in Supabase with correct title, creator, platform
- [ ] The video file exists in Cloudflare R2 at key `videos/{uuid}.mp4`
- [ ] The thumbnail exists in R2 at key `thumbnails/{uuid}.jpg`
- [ ] No temp files remain in the OS temp directory after ingestion
- [ ] Download the SAME video URL again → `isDuplicate: true`, no new R2 upload, existing record reused
- [ ] `GET /api/library` returns an array of videos with `thumbnail_url` signed URLs that work in browser
- [ ] `GET /api/library/{id}` returns full detail including a working `video_url`
- [ ] `DELETE /api/library/{id}` removes the file from R2 and sets `storage_status = 'deleted'`
- [ ] `POST /api/library/{id}/caption` returns a generated caption and saves it in `video_captions`
- [ ] Downloader settings page no longer shows "Download directory" or "Overwrite existing" fields
- [ ] No TypeScript errors (`cd app && npx tsc --noEmit`)
- [ ] Existing clipping pipeline is completely unaffected
