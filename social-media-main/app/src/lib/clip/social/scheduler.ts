import { repos } from "../../db";
import { publishReel } from "./instagram";
import { buildSignedClipMediaUrl } from "./media-url";

/**
 * Publish any scheduled posts whose `scheduledFor` time has arrived.
 *
 * This is the missing back-half of scheduling: the schedule route only *records* a
 * `status:"scheduled"` post; without this processor those posts would never go live.
 * It is driven both by a process-level interval (see `startScheduler`) and by the
 * `POST /api/clip/social/process` route (so an external cron can also trigger it).
 */
let running = false;

export async function processDuePosts(): Promise<{ processed: number; published: number }> {
  // Re-entrancy guard: the interval and a manual trigger could overlap.
  if (running) return { processed: 0, published: 0 };
  running = true;
  try {
    const settings = await repos.settings.get();
    const appBase = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const now = Date.now();
    const allPosts = await repos.scheduledPosts.getAll();
    const due = allPosts.filter(
      (p) => p.status === "scheduled" && p.scheduledFor && Date.parse(p.scheduledFor) <= now
    );
    if (due.length === 0) return { processed: 0, published: 0 };

    // Config not ready yet: leave scheduled posts untouched so they fire on a later tick
    // once publishing is enabled and a public HTTPS URL is configured.
    if (!settings.enableSocialPublish || !appBase.startsWith("https://")) {
      return { processed: 0, published: 0 };
    }

    const accounts = await repos.socialAccounts.getAll();
    let published = 0;
    for (const post of due) {
      const account = accounts.find((a) => a.id === post.accountId);
      const clip = await repos.clips.get(post.clipId);
      try {
        if (!clip) throw new Error("Clip not found.");
        if (!account) throw new Error("Account not found — it may have been disconnected.");
        const publicUrl = buildSignedClipMediaUrl(appBase, clip.id);
        await publishReel(account.igUserId!, account.accessToken, publicUrl, post.caption);
        post.status = "published";
        post.error = undefined;
        await repos.clips.update(clip.id, { caption: post.caption });
        published++;
      } catch (err) {
        post.status = "failed";
        post.error = err instanceof Error ? err.message : "Publish failed.";
      }
      // Persist status separately — if upsert fails after a successful publish we log and
      // continue rather than re-throwing (which would leave status="scheduled" and risk a
      // double-publish on the next scheduler tick).
      try {
        await repos.scheduledPosts.upsert(post);
      } catch (upsertErr) {
        console.error("[scheduler] Failed to persist post status after publish attempt:", upsertErr);
      }
    }

    return { processed: due.length, published };
  } finally {
    running = false;
  }
}

let started = false;

/** Start the once-a-minute scheduler loop (idempotent; runs in the Node server process). */
export function startScheduler(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    processDuePosts().catch(() => {
      /* swallow — a transient failure shouldn't kill the loop; the post stays scheduled. */
    });
  }, 60_000);
}
