// ponytail: Railway injects env vars directly; for local dev set them in shell or prefix with dotenv -e ../app/.env
import { runPublisherTick, resetClaimedJobs } from "./publisher";
import { runCampaignRunnerTick } from "./campaign-runner";
import { runTokenRefreshTick } from "./token-refresh";
import { WORKER_ID } from "./worker-id";

const PUBLISHER_INTERVAL_MS = 15_000;
const CAMPAIGN_RUNNER_INTERVAL_MS = 5 * 60_000;
const TOKEN_REFRESH_INTERVAL_MS = 60 * 60_000;

// Survive Next.js dev hot-reloads + duplicate instrumentation calls: start once
// per process. Mirrors the downloader's global.__dlRunner singleton.
declare global {
  var __pubWorkerStarted: boolean | undefined;
}

if (!global.__pubWorkerStarted) {
  global.__pubWorkerStarted = true;

  console.log(`[Worker] Starting. WORKER_ID=${WORKER_ID}`);

  const intervals = [
    setInterval(runCampaignRunnerTick, CAMPAIGN_RUNNER_INTERVAL_MS),
    setInterval(runPublisherTick, PUBLISHER_INTERVAL_MS),
    setInterval(runTokenRefreshTick, TOKEN_REFRESH_INTERVAL_MS),
  ];

  runCampaignRunnerTick();
  runPublisherTick();
  runTokenRefreshTick();

  console.log("[Worker] All intervals started.");

  // In-process with the Next.js server: stop our intervals and release in-flight
  // jobs on shutdown, but do NOT process.exit() — Next.js owns the process
  // lifecycle and its own SIGTERM handler drains connections and exits.
  process.on("SIGTERM", async () => {
    console.log("[Worker] SIGTERM received — stopping intervals.");
    intervals.forEach(clearInterval);
    await resetClaimedJobs();
    console.log("[Worker] In-flight jobs reset.");
  });
}
