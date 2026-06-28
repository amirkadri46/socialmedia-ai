/**
 * Next.js startup hook. Starts the scheduled-posts processor in the long-running Node
 * server process so that posts scheduled for a future time actually get published.
 * (Edge runtime can't run timers/fs, so guard on the Node runtime.)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/clip/social/scheduler");
    startScheduler();

    // Start the campaign/publisher worker in-process (publisher 15s,
    // campaign-runner 5m, token-refresh 1h). The module sets up its intervals
    // and runs each tick once on import. Wrapped so a worker init failure
    // (e.g. missing R2/Supabase env) can't take down the web server.
    try {
      await import("@/lib/worker");
    } catch (err) {
      console.error("[instrumentation] worker failed to start:", err);
    }
  }
}
