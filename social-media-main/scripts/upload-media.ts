/**
 * Upload all local media files to Supabase Storage and update DB file paths.
 *
 * Run from the app/ directory:
 *   cd app && npx tsx ../scripts/upload-media.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SECRET_KEY in ../.env (project root).
 * Idempotent: skips files that already exist in Storage.
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const ENV_PATH = path.join(__dirname, "..", ".env");
dotenv.config({ path: ENV_PATH });

const DATA_DIR = path.join(__dirname, "..", "data");
const CLIPS_DIR = path.join(DATA_DIR, "clips");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("❌  SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function fileExists(bucket: string, key: string): Promise<boolean> {
  const { data } = await db.storage.from(bucket).list(path.dirname(key), {
    search: path.basename(key),
  });
  return (data ?? []).some((f) => f.name === path.basename(key));
}

async function upload(bucket: string, key: string, filePath: string, mime: string): Promise<boolean> {
  if (await fileExists(bucket, key)) {
    return false; // already uploaded
  }
  const buf = fs.readFileSync(filePath);
  const { error } = await db.storage.from(bucket).upload(key, buf, { contentType: mime, upsert: false });
  if (error) throw new Error(`Upload failed ${bucket}/${key}: ${error.message}`);
  return true;
}

async function main() {
  console.log("📦  Uploading media files to Supabase Storage…\n");

  if (!fs.existsSync(CLIPS_DIR)) {
    console.log("No clips directory found — nothing to upload.");
    return;
  }

  let uploaded = 0;
  let skipped = 0;

  // 1. Clip MP4s and thumbnails
  const clipFiles = fs.readdirSync(CLIPS_DIR).filter((f) => !fs.statSync(path.join(CLIPS_DIR, f)).isDirectory());
  for (const file of clipFiles) {
    const filePath = path.join(CLIPS_DIR, file);
    const ext = path.extname(file).toLowerCase();
    if (ext === ".mp4") {
      const key = file; // e.g. "abc123.mp4" or "abc123-edited.mp4"
      const didUpload = await upload("clips", key, filePath, "video/mp4");
      didUpload ? uploaded++ : skipped++;
      if (didUpload) {
        // Update the clip's file_path in the DB to the storage key
        const clipId = file.replace("-edited.mp4", "").replace(".mp4", "");
        await db.from("clips").update({ file_path: key }).eq("id", clipId);
        console.log(`  ✓ clips/${key}`);
      }
    } else if (ext === ".jpg" || ext === ".jpeg") {
      const key = file; // e.g. "abc123.jpg"
      const didUpload = await upload("clip-thumbnails", key, filePath, "image/jpeg");
      didUpload ? uploaded++ : skipped++;
      if (didUpload) {
        const clipId = file.replace(".jpg", "").replace(".jpeg", "");
        await db.from("clips").update({ thumbnail: key }).eq("id", clipId);
        console.log(`  ✓ clip-thumbnails/${key}`);
      }
    }
  }

  // 2. Clip assets (editor overlays, b-roll, audio)
  const assetsDir = path.join(CLIPS_DIR, "assets");
  if (fs.existsSync(assetsDir)) {
    for (const clipId of fs.readdirSync(assetsDir)) {
      const clipAssetsDir = path.join(assetsDir, clipId);
      if (!fs.statSync(clipAssetsDir).isDirectory()) continue;
      for (const file of fs.readdirSync(clipAssetsDir)) {
        const filePath = path.join(clipAssetsDir, file);
        const ext = path.extname(file).toLowerCase().slice(1);
        const mimeMap: Record<string, string> = {
          mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
          mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
        };
        const mime = mimeMap[ext] || "application/octet-stream";
        const key = `${clipId}/${file}`;
        const didUpload = await upload("clip-assets", key, filePath, mime);
        didUpload ? uploaded++ : skipped++;
        if (didUpload) console.log(`  ✓ clip-assets/${key}`);
      }
    }
  }

  // 3. Source videos (in os.tmpdir — these may not exist if server was restarted)
  // Source videos are ephemeral temp files; skip unless they still exist.
  console.log("\nNote: Source videos are ephemeral temp files. Re-download or re-upload source videos as needed.");

  console.log(`\n✅  Upload complete — ${uploaded} files uploaded, ${skipped} already existed.`);
}

main().catch((err) => {
  console.error("❌ Upload failed:", err.message);
  process.exit(1);
});
