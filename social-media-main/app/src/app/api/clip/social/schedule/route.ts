import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { readSettings } from "@/lib/settings";
import { getClip, readAccounts, readPosts, writePosts, updateClip } from "@/lib/clip/store";
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
  const publishNow = !body.scheduledFor;

  // Build a post per account, publishing the "now" ones concurrently so N accounts don't
  // run sequentially (which could blow past the function time limit on slow transcodes).
  const results = await Promise.all(
    body.accountIds.map(async (accountId) => {
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
            post.caption = `${body.caption}`.trim();
            void mediaId;
          } catch (err) {
            post.status = "failed";
            post.error = err instanceof Error ? err.message : "Publish failed.";
          }
        }
      } else if (!account) {
        // Scheduled-for-later: validate the account now so we don't persist a post with a
        // dangling accountId that the scheduler can never publish.
        post.status = "failed";
        post.error = "Account not found — reconnect it before scheduling.";
      }

      return { accountId, post };
    })
  );

  // Persist all new posts in a single atomic write (avoids the per-account read-modify-write
  // race), and update the clip caption once if anything published.
  const posts = readPosts();
  posts.push(...results.map((r) => r.post));
  writePosts(posts);
  if (results.some((r) => r.post.status === "published")) {
    updateClip(clip.id, { caption: body.caption });
  }

  return NextResponse.json({ ok: true, results });
}
