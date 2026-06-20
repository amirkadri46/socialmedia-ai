import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { readSettings } from "@/lib/settings";
import { getClip, readAccounts, upsertPost, updateClip } from "@/lib/clip/store";
import { publishReel } from "@/lib/clip/social/instagram";
import type { ScheduledPost } from "@/lib/types";

export const maxDuration = 300;

interface ScheduleRequest {
  clipId: string;
  accountIds: string[];
  caption: string;
  scheduledFor?: string; // ISO; absent = publish now
}

export async function POST(request: Request) {
  const settings = readSettings();
  const reqUrl = new URL(request.url);
  const appBase = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || reqUrl.origin).replace(/\/$/, "");
  const body = (await request.json()) as ScheduleRequest;
  const clip = getClip(body.clipId);
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  if (!body.accountIds?.length) {
    return NextResponse.json({ error: "Select at least one account." }, { status: 400 });
  }

  const accounts = readAccounts();
  const results: { accountId: string; post: ScheduledPost }[] = [];
  const publishNow = !body.scheduledFor;

  for (const accountId of body.accountIds) {
    const account = accounts.find((a) => a.id === accountId);
    const post: ScheduledPost = {
      id: uuid(),
      clipId: body.clipId,
      accountId,
      caption: body.caption,
      scheduledFor: body.scheduledFor,
      status: publishNow ? "draft" : "scheduled",
      createdAt: new Date().toISOString(),
    };

    if (publishNow) {
      if (!settings.enableSocialPublish) {
        post.status = "draft";
        post.error =
          "Publishing is disabled. Enable it in Settings once your Meta app is approved.";
      } else if (!account) {
        post.status = "failed";
        post.error = "Account not found.";
      } else if (!appBase.startsWith("https://")) {
        post.status = "failed";
        post.error =
          "A public HTTPS URL is required to publish. Set APP_URL to your deployed (or ngrok) HTTPS URL and restart the server.";
      } else {
        try {
          // Always rebuild from the current base — a persisted clip.publicUrl can
          // point at a rotated/dead ngrok URL from an earlier publish.
          const publicUrl = `${appBase}/api/clip/media/${clip.id}`;
          const { mediaId } = await publishReel(
            account.igUserId!,
            account.accessToken,
            publicUrl,
            body.caption
          );
          post.status = "published";
          post.error = undefined;
          updateClip(clip.id, { caption: body.caption });
          post.caption = `${body.caption}`.trim();
          void mediaId;
        } catch (err) {
          post.status = "failed";
          post.error = err instanceof Error ? err.message : "Publish failed.";
        }
      }
    }

    upsertPost(post);
    results.push({ accountId, post });
  }

  return NextResponse.json({ ok: true, results });
}
