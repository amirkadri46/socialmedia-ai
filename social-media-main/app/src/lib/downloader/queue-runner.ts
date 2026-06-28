import { v4 as uuid } from "uuid";
import { readQueue, writeQueue, upsertJob, removeJob, readDownloaderSettings } from "./store";
import { inspectUrl, downloadSingleJob, detectPlatform } from "./engine";
import { ingestVideo } from "@/lib/services/video-ingestion-service";
import type { DownloadJob, DownloaderSettings } from "./types";

class QueueRunner {
  // In-memory live state (richer than disk — includes real-time progress)
  private liveJobs = new Map<string, DownloadJob>();
  private running = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private stopped = new Map<string, "paused" | "cancelled">();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  // Cache the on-disk snapshot so GET /api/downloader/queue doesn't re-read the file every 2 s.
  private diskCache: DownloadJob[] | null = null;

  /** Call once to start the background tick. Safe to call multiple times. */
  ensureStarted() {
    if (this.tickTimer !== null) return;
    // Load any persisted jobs; reset transient (in-flight) statuses to "waiting".
    const persisted = readQueue();
    this.diskCache = persisted; // seed cache so getAllJobs() skips a second disk read
    for (const j of persisted) {
      const transient =
        j.status === "waiting" ||
        j.status === "retrying" ||
        j.status === "inspecting" ||
        j.status === "downloading" ||
        j.status === "uploading";
      this.liveJobs.set(
        j.id,
        transient ? { ...j, status: "waiting", progress: 0, speed: "", eta: "" } : j
      );
    }
    this.tickTimer = setInterval(() => this.tick(), 2000);
  }

  private tick() {
    const settings = readDownloaderSettings();
    const available = settings.concurrentDownloads - this.running.size;
    if (available <= 0) return;

    // Use liveJobs directly — waiting/retrying jobs are always in memory, no disk read needed.
    const waiting = Array.from(this.liveJobs.values()).filter(
      (j) => j.status === "waiting" || j.status === "retrying"
    );
    for (const job of waiting.slice(0, available)) {
      this.processJob(job, settings); // fire-and-forget
    }
  }

  private async processJob(job: DownloadJob, settings: DownloaderSettings) {
    if (this.running.has(job.id)) return;
    this.running.add(job.id);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    try {
      // Phase 1: inspect (title/creator/thumbnail) if unknown.
      if (!job.title) {
        this.patch(job.id, { status: "inspecting" });
        const meta = await inspectUrl(job.url);
        this.patch(job.id, { ...meta, status: "downloading" });
      } else {
        this.patch(job.id, { status: "downloading" });
      }

      // Phase 2: download to temp dir.
      const { videoPath, thumbPath } = await downloadSingleJob(
        this.getJob(job.id)!,
        settings.quality,
        (progress, speed, eta) => this.patch(job.id, { progress, speed, eta }),
        controller.signal
      );

      if (controller.signal.aborted) throw new Error("Cancelled");
      this.patch(job.id, { status: "uploading", progress: 100 });

      // Phase 3: ingest (upload to R2 + register in Supabase).
      try {
        const current = this.getJob(job.id)!;
        const { videoId, isDuplicate } = await ingestVideo({
          tempVideoPath: videoPath,
          tempThumbPath: thumbPath,
          meta: {
            title: current.title || "Untitled",
            creator: current.creator || "Unknown",
            platform: current.platform === "youtube" ? "youtube"
                    : current.platform === "instagram" ? "instagram"
                    : "unknown",
            durationSec: 0,
            originalUrl: current.url,
          },
        });

        this.patch(job.id, {
          status: "completed",
          speed: "",
          eta: "",
          videoLibraryId: videoId,
          ...(isDuplicate ? { ingestError: "Duplicate — existing video reused" } : {}),
        });
      } catch (ingestErr) {
        this.patch(job.id, {
          status: "completed",
          speed: "",
          eta: "",
          ingestError: String(ingestErr),
        });
      }

      upsertJob(this.getJob(job.id)!);
      this.diskCache = null;
    } catch (err) {
      const stopped = this.stopped.get(job.id);
      if (stopped) {
        this.patch(job.id, {
          status: stopped,
          speed: "",
          eta: "",
          error: stopped === "cancelled" ? "Cancelled by user" : "",
        });
        upsertJob(this.getJob(job.id)!);
        this.diskCache = null;
        return;
      }
      const current = this.getJob(job.id)!;
      if (current.retryCount < settings.retryCount) {
        this.patch(job.id, {
          status: "retrying",
          retryCount: current.retryCount + 1,
          error: String(err),
        });
      } else {
        this.patch(job.id, { status: "failed", error: String(err) });
      }
      upsertJob(this.getJob(job.id)!);
      this.diskCache = null;
    } finally {
      this.running.delete(job.id);
      this.controllers.delete(job.id);
      this.stopped.delete(job.id);
    }
  }

  private patch(id: string, updates: Partial<DownloadJob>) {
    const existing = this.liveJobs.get(id);
    if (existing) this.liveJobs.set(id, { ...existing, ...updates });
  }

  addJobs(urls: string[], quality: DownloadJob["quality"] = "best"): DownloadJob[] {
    const settings = readDownloaderSettings();
    const existingUrls = new Set(this.getAllJobs().filter((j) => j.status !== "failed").map((j) => j.url));
    this.diskCache = null;
    const newJobs: DownloadJob[] = [];

    for (const url of urls) {
      if (settings.skipDuplicates && existingUrls.has(url)) continue;
      existingUrls.add(url);
      const job: DownloadJob = {
        id: uuid(),
        url,
        platform: detectPlatform(url),
        creator: "",
        title: "",
        thumbnail: "",
        quality,
        status: "waiting",
        progress: 0,
        speed: "",
        eta: "",
        error: "",
        retryCount: 0,
        videoLibraryId: "",
        ingestError: "",
        addedAt: new Date().toISOString(),
      };
      this.liveJobs.set(job.id, job);
      upsertJob(job);
      newJobs.push(job);
    }
    this.tick();
    return newJobs;
  }

  getAllJobs(): DownloadJob[] {
    // Merge persisted (completed/failed) with live (in-progress); live wins.
    // diskCache avoids re-reading the JSON file on every 2 s poll.
    if (this.diskCache === null) this.diskCache = readQueue();
    const merged = new Map<string, DownloadJob>();
    for (const j of this.diskCache) merged.set(j.id, j);
    for (const [id, j] of this.liveJobs) merged.set(id, j);
    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );
  }

  getJob(id: string): DownloadJob | undefined {
    return this.liveJobs.get(id) ?? readQueue().find((j) => j.id === id);
  }

  cancelJob(id: string) {
    const job = this.getJob(id);
    if (!job) return;
    if (job.status === "failed" || job.status === "completed" || job.status === "cancelled") {
      this.liveJobs.delete(id);
      removeJob(id);
      this.diskCache = null;
      return;
    }
    this.stopped.set(id, "cancelled");
    this.controllers.get(id)?.abort();
    this.patch(id, { status: "cancelled", speed: "", eta: "", error: "Cancelled by user" });
    upsertJob(this.getJob(id)!);
    this.diskCache = null;
  }

  pauseJob(id: string) {
    const job = this.getJob(id);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "cancelled") return;
    this.stopped.set(id, "paused");
    this.controllers.get(id)?.abort();
    this.patch(id, { status: "paused", speed: "", eta: "" });
    upsertJob(this.getJob(id)!);
    this.diskCache = null;
  }

  resumeJob(id: string) {
    const job = this.getJob(id);
    if (!job || job.status !== "paused") return;
    if (this.running.has(id)) return;
    this.stopped.delete(id);
    this.patch(id, { status: "waiting", progress: 0, speed: "", eta: "", error: "" });
    upsertJob(this.getJob(id)!);
    this.diskCache = null;
    this.tick();
  }

  clearFinished() {
    const active = this.getAllJobs().filter(
      (j) => j.status !== "completed" && j.status !== "failed"
        && j.status !== "cancelled"
    );
    this.liveJobs = new Map(active.map((j) => [j.id, j]));
    writeQueue(active);
    this.diskCache = null;
  }
}

// Survive Next.js dev hot-reloads: one instance per process.
declare global {
  var __dlRunner: QueueRunner | undefined;
}
export const queueRunner: QueueRunner =
  global.__dlRunner ?? (global.__dlRunner = new QueueRunner());
