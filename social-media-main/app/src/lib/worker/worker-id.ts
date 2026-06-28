import os from "os";
import { randomUUID } from "crypto";

// Unique per running process so lock ownership (claimed_by / worker_id) is
// correct even when the web tier runs multiple replicas. Explicit WORKER_ID
// wins; then Railway's per-replica id; then hostname+pid; finally a UUID.
export const WORKER_ID =
  process.env.WORKER_ID ||
  process.env.RAILWAY_REPLICA_ID ||
  `${os.hostname()}-${process.pid}` ||
  randomUUID();
