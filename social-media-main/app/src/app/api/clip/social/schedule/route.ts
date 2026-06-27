import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { repos } from "@/lib/db";
import { publishReel } from "@/lib/clip/social/instagram";
import { buildSignedClipMediaUrl } from "@/lib/clip/social/media-url";
import type { ScheduledPost } from "@/lib/types";

export const maxDuration = 300;

interface ScheduleRequest {
  clipId: string;
  accountIds: string[];
  caption: string;
  scheduledFor?: string; // ISO; absent = publish now
}

export async function POST(request: Request) {
  const settings = await repos.settings.get();
  const reqUrl = new URL(request.url);
  const appBase = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || reqUrl.origin).replace(/\/$/, "");
  let body: ScheduleRequest;
  try {
    body = (await request.json()) as ScheduleRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }
  const clip = await repos.clips.get(body.clipId);
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  if (!body.accountIds?.length) {
    return NextResponse.json({ error: "Select at least one account." }, { status: 400 });
  }

  const accounts = await repos.socialAccounts.getAll();
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
            const publicUrl = buildSignedClipMediaUrl(appBase, clip.id);
            const { mediaId } = await publishReel(
              account.igUserId!,
              account.accessToken,
              publicUrl,
              body.caption
            );
            console.log(`[publish] Clip ${clip.id} published to @${account.username} — media ${mediaId}`);
            post.status = "published";
            post.error = undefined;
            post.caption = `${body.caption}`.trim();
            void mediaId;
          } catch (err) {
            console.error(`[publish] Failed to publish clip ${clip.id} to account ${accountId}:`, err instanceof Error ? err.message : err);
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

  // Persist all new posts serially — concurrent upserts on the file backend would race
  // on the same JSON file (both read before either writes, second rename drops the first).
  for (const r of results) await repos.scheduledPosts.upsert(r.post);
  if (results.some((r) => r.post.status === "published")) {
    await repos.clips.update(clip.id, { caption: body.caption });
  }

  return NextResponse.json({ ok: true, results });
}
