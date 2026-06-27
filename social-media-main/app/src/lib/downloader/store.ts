import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import path from "path";
import type { DownloadJob, DownloaderSettings } from "./types";
import { DEFAULT_DOWNLOADER_SETTINGS } from "./types";

const DATA_DIR = path.join(process.cwd(), "..", "data");
const QUEUE_PATH = path.join(DATA_DIR, "download-queue.json");
const DL_SETTINGS_PATH = path.join(DATA_DIR, "downloader-settings.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function writeAtomic(p: string, data: string) {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, "utf-8");
  try {
    renameSync(tmp, p);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

export function readQueue(): DownloadJob[] {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf-8")) as DownloadJob[];
  } catch {
    return [];
  }
}

export function writeQueue(jobs: DownloadJob[]) {
  ensureDataDir();
  writeAtomic(QUEUE_PATH, JSON.stringify(jobs, null, 2));
}

export function upsertJob(job: DownloadJob) {
  const jobs = readQueue();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.unshift(job);
  writeQueue(jobs);
}

export function removeJob(jobId: string) {
  writeQueue(readQueue().filter((j) => j.id !== jobId));
}

export function readDownloaderSettings(): DownloaderSettings {
  if (!existsSync(DL_SETTINGS_PATH)) return { ...DEFAULT_DOWNLOADER_SETTINGS };
  try {
    return { ...DEFAULT_DOWNLOADER_SETTINGS, ...JSON.parse(readFileSync(DL_SETTINGS_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULT_DOWNLOADER_SETTINGS };
  }
}

export function writeDownloaderSettings(s: DownloaderSettings) {
  ensureDataDir();
  writeAtomic(DL_SETTINGS_PATH, JSON.stringify(s, null, 2));
}
