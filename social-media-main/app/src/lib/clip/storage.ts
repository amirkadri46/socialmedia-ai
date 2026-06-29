import { readFileSync } from "fs";
import { serverClient } from "../db/client";
import { deleteClipLocalFiles, deleteJobLocalFiles } from "./store";

/** True when clip media must live in Supabase Storage rather than local disk. */
export const usingSupabaseStorage = () => process.env.STORAGE_BACKEND === "supabase";

// Buckets are created lazily once per process (Supabase doesn't auto-create them).
const ensured = new Set<string>();
async function ensureBucket(bucket: string): Promise<void> {
  if (ensured.has(bucket)) return;
  // createBucket errors if it already exists — that's the expected happy path on reruns.
  // Any OTHER error (auth/quota/network) means the bucket may not exist, so don't cache it
  // as ensured; let the next call retry instead of silently treating failure as success.
  const { error } = await serverClient().storage.createBucket(bucket, { public: false });
  if (error && !/already exists|resource already exists/i.test(error.message)) {
    throw new Error(`Could not ensure storage bucket "${bucket}": ${error.message}`);
  }
  ensured.add(bucket);
}

/**
 * Upload a local file to a Supabase Storage bucket and return the object key.
 * Used by the pipeline/editor in supabase mode so the serving routes (which build
 * signed URLs from clip.filePath / clip.thumbnail / {jobId}.mp4) actually resolve.
 */
export async function uploadClipFile(
  bucket: string,
  key: string,
  localPath: string,
  contentType: string
): Promise<string> {
  await ensureBucket(bucket);
  const body = readFileSync(localPath);
  const { error } = await serverClient()
    .storage.from(bucket)
    .upload(key, body, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed (${bucket}/${key}): ${error.message}`);
  return key;
}

/**
 * Delete all media for a clip (rendered mp4, edited mp4, thumbnail, uploaded assets) from
 * wherever it lives — Supabase Storage in supabase mode, local disk otherwise. Best-effort:
 * a missing object is not an error (the goal is just "no orphaned files left behind").
 */
export async function purgeClipFiles(clipId: string): Promise<void> {
  if (usingSupabaseStorage()) {
    const c = serverClient();
    throwUnlessMissing(await c.storage.from("clips").remove([`${clipId}.mp4`, `${clipId}-edited.mp4`]));
    throwUnlessMissing(await c.storage.from("clip-thumbnails").remove([`${clipId}.jpg`]));
    const listing = await c.storage.from("clip-assets").list(clipId);
    throwUnlessMissing(listing);
    if (listing.data?.length) {
      throwUnlessMissing(await c.storage.from("clip-assets").remove(listing.data.map((o) => `${clipId}/${o.name}`)));
    }
  }
  deleteClipLocalFiles(clipId); // no-op when the files live only in storage
}

/** Delete a job's source video + transcript (storage + local). Best-effort. */
export async function purgeJobFiles(jobId: string): Promise<void> {
  if (usingSupabaseStorage()) {
    throwUnlessMissing(await serverClient().storage.from("clip-sources").remove([`${jobId}.mp4`]));
  }
  deleteJobLocalFiles(jobId);
}

/**
 * A missing object/bucket is fine (we just want "no orphans left"), but a real failure
 * (auth, quota, network) must propagate so the DELETE route aborts before deleting DB rows
 * — otherwise we'd report success while files leak in storage.
 */
function throwUnlessMissing(res: { error: { message: string } | null }): void {
  if (res.error && !/not.?found|does not exist|no such/i.test(res.error.message)) {
    throw new Error(`Storage cleanup failed: ${res.error.message}`);
  }
}
