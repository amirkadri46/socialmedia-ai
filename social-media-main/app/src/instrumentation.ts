/**
 * Next.js startup hook. Starts the scheduled-posts processor in the long-running Node
 * server process so that posts scheduled for a future time actually get published.
 * (Edge runtime can't run timers/fs, so guard on the Node runtime.)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/clip/social/scheduler");
    startScheduler();
  }
}
