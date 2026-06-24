import { NextResponse } from "next/server";
import { processDuePosts } from "@/lib/clip/social/scheduler";

export const maxDuration = 300;

/**
 * Publish any scheduled posts that are now due. Driven by the in-process scheduler
 * interval; also exposed here so an external cron (e.g. a Railway scheduled job) can
 * trigger it on demand.
 */
export async function POST() {
  const result = await processDuePosts();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = POST;
