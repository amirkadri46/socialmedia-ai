import { NextResponse } from "next/server";
import { writeFileSync } from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { clipAssetsDir } from "@/lib/clip/store";

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
  const ext = (f.name.split(".").pop() || "bin").toLowerCase();
  const name = `${uuid()}.${ext}`;
  const buffer = Buffer.from(await f.arrayBuffer());
  writeFileSync(path.join(clipAssetsDir(clipId), name), buffer);
  return NextResponse.json({ src: `/api/clip/asset/${clipId}/${name}`, name });
}
