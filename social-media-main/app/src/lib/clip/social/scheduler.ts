import { readSettings } from "../../settings";
import { readPosts, writePosts, readAccounts, getClip, updateClip } from "../store";
import { publishReel } from "./instagram";

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
    const settings = readSettings();
    const appBase = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    const now = Date.now();
    const due = readPosts().filter(
      (p) => p.status === "scheduled" && p.scheduledFor && Date.parse(p.scheduledFor) <= now
    );
    if (due.length === 0) return { processed: 0, published: 0 };

    // Config not ready yet: leave scheduled posts untouched so they fire on a later tick
    // once publishing is enabled and a public HTTPS URL is configured.
    if (!settings.enableSocialPublish || !appBase.startsWith("https://")) {
      return { processed: 0, published: 0 };
    }

    const accounts = readAccounts();
    let published = 0;
    for (const post of due) {
      const account = accounts.find((a) => a.id === post.accountId);
      const clip = getClip(post.clipId);
      try {
        if (!clip) throw new Error("Clip not found.");
        if (!account) throw new Error("Account not found — it may have been disconnected.");
        const publicUrl = `${appBase}/api/clip/media/${clip.id}`;
        await publishReel(account.igUserId!, account.accessToken, publicUrl, post.caption);
        post.status = "published";
        post.error = undefined;
        updateClip(clip.id, { caption: post.caption });
        published++;
      } catch (err) {
        post.status = "failed";
        post.error = err instanceof Error ? err.message : "Publish failed.";
      }
    }

    // Merge the updated posts back into the latest on-disk list (other writes may have
    // happened while we were awaiting the network), then persist atomically.
    const latest = readPosts();
    for (const updated of due) {
      const idx = latest.findIndex((p) => p.id === updated.id);
      if (idx >= 0) latest[idx] = updated;
    }
    writePosts(latest);
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
