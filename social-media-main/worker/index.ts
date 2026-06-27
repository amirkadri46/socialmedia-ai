// ponytail: Railway injects env vars directly; for local dev set them in shell or prefix with dotenv -e ../app/.env
import { runPublisherTick, resetClaimedJobs } from "./publisher";
import { runCampaignRunnerTick } from "./campaign-runner";
import { runTokenRefreshTick } from "./token-refresh";

const PUBLISHER_INTERVAL_MS = 15_000;
const CAMPAIGN_RUNNER_INTERVAL_MS = 5 * 60_000;
const TOKEN_REFRESH_INTERVAL_MS = 60 * 60_000;

console.log(`[Worker] Starting. WORKER_ID=${process.env.WORKER_ID ?? "worker-1"}`);

const intervals = [
  setInterval(runCampaignRunnerTick, CAMPAIGN_RUNNER_INTERVAL_MS),
  setInterval(runPublisherTick, PUBLISHER_INTERVAL_MS),
  setInterval(runTokenRefreshTick, TOKEN_REFRESH_INTERVAL_MS),
];

runCampaignRunnerTick();
runPublisherTick();
runTokenRefreshTick();

console.log("[Worker] All intervals started.");

// finding #7: graceful shutdown — stop intervals, reset in-flight jobs so the
// next worker instance can pick them up immediately rather than waiting for the
// stale-job reaper (15-minute window)
process.on("SIGTERM", async () => {
  console.log("[Worker] SIGTERM received — shutting down.");
  intervals.forEach(clearInterval);
  await resetClaimedJobs();
  console.log("[Worker] In-flight jobs reset. Exiting.");
  process.exit(0);
});
