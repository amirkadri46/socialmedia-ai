import { NextResponse } from "next/server";
import { writeFileSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { clipAssetsDir } from "@/lib/clip/store";
import { serverClient } from "@/lib/db/client";

export const maxDuration = 120;

/** Upload an editor asset (media overlay / b-roll / audio) for a clip. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ clipId: string }> }
) {
  const { clipId } = await params;
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const f = file as File;
  const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB
  if (f.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: "File too large (max 50 MB)." }, { status: 413 });
  }
  const ext = (f.name.split(".").pop() || "bin").toLowerCase();
  const name = `${uuid()}.${ext}`;
  const buffer = Buffer.from(await f.arrayBuffer());

  if (process.env.STORAGE_BACKEND === "supabase") {
    const { error } = await serverClient()
      .storage.from("clip-assets")
      .upload(`${clipId}/${name}`, buffer, { contentType: f.type || "application/octet-stream" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    writeFileSync(path.join(clipAssetsDir(clipId), name), buffer);
  }

  return NextResponse.json({ src: `/api/clip/asset/${clipId}/${name}`, name });
}
