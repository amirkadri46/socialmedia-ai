# Bulk YouTube Shorts & Instagram Reels Downloader

**Date:** 2026-06-26  
**Status:** Ready to implement

---

## What This Builds

A new "Downloader" section in the app sidebar. Users can:

1. **Paste bulk video URLs** (YouTube Shorts + Instagram Reels, mixed) into a textarea — hit Download and every URL enters the queue.
2. **Paste a creator profile URL** (YouTube `@creator` or Instagram `instagram.com/creator`) — the system scrapes every public Short/Reel and adds them all to the queue automatically.

Downloads run concurrently, save to `D:\downloaded videos` (configurable), and produce `{Title}.mp4` + `{Title}.jpg` organized by platform and creator. The queue survives page refresh (persisted to `data/download-queue.json`). Progress is polled every 2 seconds.

---

## Confirmed Decisions

- **Save dir:** `D:\downloaded videos` as default, user-configurable in Downloader Settings
- **Output structure:** `{downloadDir}\YouTube\{Creator}\{Title}.mp4` and `{downloadDir}\Instagram\{Creator}\{Title}.mp4`
- **yt-dlp:** Reuse existing `lib/clip/ffmpeg.ts` (`run()`, `ytDlpPath()`, `ffmpegPath()`, `ytDlpAvailable()`)
- **Instagram cookies:** Read from existing `readSettings().ytDlpCookiesText` / `ytDlpCookiesBrowser` in Clip Settings — no new cookie UI
- **Profile scraping:** `yt-dlp --flat-playlist --dump-single-json` with those same cookies
- **Queue persistence:** `data/download-queue.json` (like `clip-jobs.json`)
- **Progress delivery:** Client polls `GET /api/downloader/queue` every 2 seconds
- **UI integration:** New "Downloader" sidebar section (icon: `Download` from lucide-react), items: Downloads (`/downloader`) + Settings (`/downloader/settings`)

---

## Architecture

```
lib/downloader/
  types.ts            ← DownloadJob, DownloaderSettings types + defaults
  store.ts            ← read/write data/download-queue.json + data/downloader-settings.json
  engine.ts           ← inspect (get metadata) + download (yt-dlp) for a single job
  scraper.ts          ← profile URL → list of video URLs via yt-dlp --flat-playlist
  queue-runner.ts     ← process-level singleton: concurrent downloads + retry loop

app/src/app/api/downloader/
  queue/route.ts      ← GET (all jobs), POST (add jobs), DELETE (clear/cancel)
  scrape/route.ts     ← POST { url, limit } → { urls: string[] }
  settings/route.ts   ← GET + POST downloader settings

app/src/app/downloader/
  page.tsx            ← main page: input tabs + queue table + status bar
  settings/page.tsx   ← downloader settings page

app/src/components/downloader/
  url-input-panel.tsx      ← bulk URLs textarea + .txt file upload
  profile-input-panel.tsx  ← profile URL + limit selector + Add to Queue button
  queue-table.tsx          ← the queue (thumbnail, platform, creator, title, progress, status)
  status-bar.tsx           ← bottom bar: total | downloaded | failed | remaining | speed

Modified:
  app/src/components/app-sidebar.tsx  ← add "downloader" section
```

---

## Step-by-Step Implementation

### Step 1 — Types (`lib/downloader/types.ts`)

Create `app/src/lib/downloader/types.ts`:

```typescript
export type DownloadStatus =
  | "waiting"
  | "inspecting"
  | "downloading"
  | "completed"
  | "failed"
  | "retrying";

export type DownloadPlatform = "youtube" | "instagram" | "unknown";
export type DownloadQuality = "best" | "1080p" | "720p";

export interface DownloadJob {
  id: string;
  url: string;
  platform: DownloadPlatform;
  creator: string;      // populated after inspect
  title: string;        // populated after inspect
  thumbnail: string;    // populated after inspect
  quality: DownloadQuality;
  status: DownloadStatus;
  progress: number;     // 0–100
  speed: string;        // "1.2 MB/s" or ""
  eta: string;          // "00:02" or ""
  error: string;
  retryCount: number;
  outputPath: string;
  addedAt: string;      // ISO timestamp
}

export interface DownloaderSettings {
  downloadDir: string;
  quality: DownloadQuality;
  concurrentDownloads: number;
  retryCount: number;
  overwriteExisting: boolean;
  skipDuplicates: boolean;
}

export const DEFAULT_DOWNLOADER_SETTINGS: DownloaderSettings = {
  downloadDir: "D:\\downloaded videos",
  quality: "best",
  concurrentDownloads: 3,
  retryCount: 3,
  overwriteExisting: false,
  skipDuplicates: true,
};
```

---

### Step 2 — Store (`lib/downloader/store.ts`)

Create `app/src/lib/downloader/store.ts`. Mirror the pattern from `lib/settings.ts` (atomic writes, DATA_DIR = `process.cwd() + "/../data"`):

```typescript
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
```

---

### Step 3 — Engine (`lib/downloader/engine.ts`)

Create `app/src/lib/downloader/engine.ts`. This handles inspect + download for one job. Reuse `run`, `ytDlpPath`, `ffmpegPath`, `ytDlpAvailable` from `@/lib/clip/ffmpeg`. Read cookies from `readSettings()` in `@/lib/settings`.

**`detectPlatform(url)`** — returns `"youtube"` if `youtube.com` or `youtu.be`, `"instagram"` if `instagram.com`, else `"unknown"`.

**`buildCookieArgs()`** — same logic as `cookieArgs()` in `lib/clip/download.ts`:
- If `readSettings().ytDlpCookiesText` is non-empty, write it to a temp `dl-cookies.txt` file (with `# Netscape HTTP Cookie File` header if missing) and return `["--cookies", filePath]`.
- Else if `readSettings().ytDlpCookiesBrowser` is non-empty, return `["--cookies-from-browser", browser]`.
- Else return `[]`.

**`sanitizeFilename(name: string): string`** — remove characters forbidden in Windows filenames: `< > : " / \ | ? *` and trim whitespace.

**`qualityFormat(q: DownloadQuality): string`**:
- `"1080p"` → `"bv*[height<=1080]+ba/b[height<=1080]/b"`
- `"720p"` → `"bv*[height<=720]+ba/b[height<=720]/b"`
- `"best"` → `"bv*[height<=1080]+ba/b[height<=1080]/b"` (cap at 1080p)

**`inspectUrl(url: string): Promise<{ title, creator, thumbnail, platform }>`**:

```
yt-dlp --dump-single-json --no-warnings --no-playlist ...cookieArgs url
```

Parse JSON. Return:
```typescript
{
  title: json.title || "Untitled",
  creator: json.uploader || json.channel || json.uploader_id || "Unknown",
  thumbnail: json.thumbnail || "",
  platform: detectPlatform(url),
}
```

**`downloadSingleJob(job, downloadDir, quality, overwrite, onProgress)`**:

Build output path template:
```
{downloadDir}\{platformFolder}\%(uploader)s\%(title)s.%(ext)s
```
where `platformFolder` is `"YouTube"` for youtube, `"Instagram"` for instagram, `"Other"` otherwise.

Ensure `{downloadDir}\{platformFolder}` exists with `mkdirSync(..., { recursive: true })`.

yt-dlp args:
```
-f {qualityFormat(quality)}
--merge-output-format mp4
--write-thumbnail
--convert-thumbnails jpg
--ffmpeg-location {path.dirname(ffmpegPath())}
--no-playlist
--no-warnings
...cookieArgs
--force-overwrites OR --no-overwrites  (based on overwrite param)
-o {outTemplate}
{job.url}
```

Pass `onStderr` to `run()`. In the callback, parse progress lines:
```
/\[download\]\s+([\d.]+)%.*?at\s+([\S]+)\s+ETA\s+(\S+)/
```
Call `onProgress(parseFloat(m[1]), m[2], m[3])` when matched.

Return `void` (we don't need the exact output path; the file lands in the expected folder).

---

### Step 4 — Scraper (`lib/downloader/scraper.ts`)

Create `app/src/lib/downloader/scraper.ts`.

**`scrapeProfileUrls(profileUrl: string, limit?: number): Promise<string[]>`**:

1. Detect platform from URL.
2. For YouTube: if URL matches `youtube.com/@something` and does NOT end with `/shorts`, append `/shorts` to target only Shorts.
3. For Instagram: use URL as-is (reels page scraping works with cookies).

Run:
```
yt-dlp --flat-playlist --dump-single-json --no-warnings ...cookieArgs url
```

Parse result:
- `json.entries` is an array of `{ url, webpage_url, id, ... }`.
- Map each to `entry.url || entry.webpage_url || (platform === "youtube" ? "https://www.youtube.com/shorts/" + entry.id : "https://www.instagram.com/reel/" + entry.id)`.
- Filter out empty/null values.
- If `limit` is set, return first `limit` items.

Return the array of video URLs.

If `yt-dlp --flat-playlist` returns no entries (IG without cookies, private profile, etc.), throw a descriptive error.

---

### Step 5 — Queue Runner (`lib/downloader/queue-runner.ts`)

Create `app/src/lib/downloader/queue-runner.ts`. This is a **process-level singleton** — one instance for the lifetime of the Next.js dev server.

```typescript
import { v4 as uuid } from "uuid";
import { readQueue, writeQueue, upsertJob, readDownloaderSettings } from "./store";
import { inspectUrl, downloadSingleJob, detectPlatform } from "./engine";
import type { DownloadJob, DownloaderSettings } from "./types";

class QueueRunner {
  // In-memory live state (richer than disk — includes real-time progress)
  private liveJobs = new Map<string, DownloadJob>();
  private running = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  /** Call once to start the background tick. Safe to call multiple times. */
  ensureStarted() {
    if (this.tickTimer !== null) return;
    // Load any persisted waiting/retrying jobs into live state
    const persisted = readQueue();
    for (const j of persisted) {
      if (j.status === "waiting" || j.status === "retrying" || j.status === "inspecting" || j.status === "downloading") {
        // Reset transient statuses to "waiting" so they restart cleanly
        this.liveJobs.set(j.id, { ...j, status: j.status === "completed" || j.status === "failed" ? j.status : "waiting", progress: 0, speed: "", eta: "" });
      } else {
        this.liveJobs.set(j.id, j);
      }
    }
    this.tickTimer = setInterval(() => this.tick(), 2000);
  }

  private async tick() {
    const settings = readDownloaderSettings();
    const available = settings.concurrentDownloads - this.running.size;
    if (available <= 0) return;

    const all = this.getAllJobs();
    const waiting = all.filter((j) => j.status === "waiting" || j.status === "retrying");
    const toStart = waiting.slice(0, available);

    for (const job of toStart) {
      this.processJob(job, settings); // fire-and-forget
    }
  }

  private async processJob(job: DownloadJob, settings: DownloaderSettings) {
    if (this.running.has(job.id)) return;
    this.running.add(job.id);

    try {
      // Phase 1: Inspect (get title/creator/thumbnail if not already known)
      if (!job.title) {
        this.patch(job.id, { status: "inspecting" });
        const meta = await inspectUrl(job.url);
        this.patch(job.id, { ...meta, status: "downloading" });
      } else {
        this.patch(job.id, { status: "downloading" });
      }

      // Phase 2: Download
      await downloadSingleJob(
        this.getJob(job.id)!,
        settings.downloadDir,
        settings.quality,
        settings.overwriteExisting,
        (progress, speed, eta) => {
          this.patch(job.id, { progress, speed, eta });
        }
      );

      this.patch(job.id, { status: "completed", progress: 100, speed: "", eta: "" });
      upsertJob(this.getJob(job.id)!);
    } catch (err) {
      const current = this.getJob(job.id)!;
      if (current.retryCount < settings.retryCount) {
        this.patch(job.id, { status: "retrying", retryCount: current.retryCount + 1, error: String(err) });
        upsertJob(this.getJob(job.id)!);
      } else {
        this.patch(job.id, { status: "failed", error: String(err) });
        upsertJob(this.getJob(job.id)!);
      }
    } finally {
      this.running.delete(job.id);
    }
  }

  private patch(id: string, updates: Partial<DownloadJob>) {
    const existing = this.liveJobs.get(id);
    if (existing) this.liveJobs.set(id, { ...existing, ...updates });
  }

  /** Add new jobs to the queue */
  addJobs(urls: string[], quality: DownloadJob["quality"] = "best"): DownloadJob[] {
    const settings = readDownloaderSettings();
    const existingUrls = new Set(this.getAllJobs().map((j) => j.url));
    const newJobs: DownloadJob[] = [];

    for (const url of urls) {
      if (settings.skipDuplicates && existingUrls.has(url)) continue;
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
        outputPath: "",
        addedAt: new Date().toISOString(),
      };
      this.liveJobs.set(job.id, job);
      upsertJob(job);
      newJobs.push(job);
    }
    return newJobs;
  }

  getAllJobs(): DownloadJob[] {
    // Merge persisted (for completed/failed) with live (for in-progress)
    const persisted = readQueue();
    const merged = new Map<string, DownloadJob>();
    for (const j of persisted) merged.set(j.id, j);
    for (const [id, j] of this.liveJobs) merged.set(id, j);
    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
    );
  }

  getJob(id: string): DownloadJob | undefined {
    return this.liveJobs.get(id) ?? readQueue().find((j) => j.id === id);
  }

  cancelJob(id: string) {
    this.patch(id, { status: "failed", error: "Cancelled by user" });
    upsertJob(this.getJob(id)!);
    // Note: can't kill the yt-dlp child process easily here; it will complete
    // but result won't be marked completed. For v1, cancel = mark failed.
  }

  clearFinished() {
    const active = this.getAllJobs().filter(
      (j) => j.status !== "completed" && j.status !== "failed"
    );
    const cleared = new Map<string, DownloadJob>();
    for (const j of active) cleared.set(j.id, j);
    this.liveJobs = cleared;
    writeQueue(active);
  }
}

export const queueRunner = new QueueRunner();
```

**Important:** Export `queueRunner` as a named singleton. In every API route that needs it, call `queueRunner.ensureStarted()` before any operation.

---

### Step 6 — API Routes

#### `app/src/app/api/downloader/queue/route.ts`

**GET** — return all jobs:
```typescript
import { queueRunner } from "@/lib/downloader/queue-runner";
export async function GET() {
  queueRunner.ensureStarted();
  return Response.json(queueRunner.getAllJobs());
}
```

**POST** — add URLs to queue:
```typescript
// Body: { urls: string[], quality?: DownloadQuality }
export async function POST(request: Request) {
  queueRunner.ensureStarted();
  const { urls, quality } = await request.json();
  const added = queueRunner.addJobs(urls, quality);
  return Response.json({ added: added.length });
}
```

**DELETE** — clear finished OR cancel specific job:
```typescript
// Body: { jobId?: string } — if jobId present, cancel that job; else clear all finished
export async function DELETE(request: Request) {
  queueRunner.ensureStarted();
  const body = await request.json().catch(() => ({}));
  if (body.jobId) {
    queueRunner.cancelJob(body.jobId);
  } else {
    queueRunner.clearFinished();
  }
  return Response.json({ ok: true });
}
```

#### `app/src/app/api/downloader/scrape/route.ts`

**POST** — scrape a creator profile URL:
```typescript
// Body: { url: string, limit?: number }
// Returns: { urls: string[] } or error
import { scrapeProfileUrls } from "@/lib/downloader/scraper";
export async function POST(request: Request) {
  const { url, limit } = await request.json();
  try {
    const urls = await scrapeProfileUrls(url, limit);
    return Response.json({ urls });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export const maxDuration = 120; // scraping can take time
```

#### `app/src/app/api/downloader/settings/route.ts`

```typescript
import { readDownloaderSettings, writeDownloaderSettings } from "@/lib/downloader/store";

export async function GET() {
  return Response.json(readDownloaderSettings());
}

export async function POST(request: Request) {
  const body = await request.json();
  writeDownloaderSettings(body);
  return Response.json({ ok: true });
}
```

---

### Step 7 — UI Components

#### `app/src/components/downloader/url-input-panel.tsx`

Client component. Props: `onSubmit: (urls: string[]) => void`, `loading: boolean`.

UI:
- `<Textarea>` — large (min-height 140px), placeholder: `"Paste video URLs here, one per line...\n\nhttps://www.youtube.com/shorts/xxxx\nhttps://www.instagram.com/reel/yyyy/"`, onChange updates local state.
- Below textarea: two buttons side by side:
  - "Upload .txt file" button (ghost) → hidden `<input type="file" accept=".txt">` triggered via ref. On file select, read file contents and populate the textarea.
  - "Add to Queue" primary button (with `Download` icon) → calls `onSubmit(parseUrls(text))`. Disabled if textarea is empty or `loading` is true.
- `parseUrls(text)` — split by newlines, trim each line, filter non-empty lines that start with `http`.
- Show a small counter below textarea: `"X URLs detected"` updating in real time.

#### `app/src/components/downloader/profile-input-panel.tsx`

Client component. Props: `onSubmit: (urls: string[], profileMeta: { url: string, limit?: number }) => void`, `loading: boolean`, `scraping: boolean`, `scraped: number`.

UI:
- `<Input>` — placeholder: `"https://www.youtube.com/@creator  or  https://www.instagram.com/creator/"`.
- `<Select>` for limit: "All videos" (no limit), "Latest 10", "Latest 25", "Latest 50", "Latest 100", "Custom".
  - If "Custom" selected, show a number `<Input>`.
- "Scrape & Add to Queue" button (primary, with `Search` icon). On click, POST to `/api/downloader/scrape`, then POST discovered URLs to `/api/downloader/queue`.
- While scraping: show spinner + "Scraping profile..." text inside button.
- After scrape: show toast "Found X videos, adding to queue".
- Error state: show red text below the input.
- Auto-detect platform from URL and show a small badge (YouTube / Instagram) next to the input.

#### `app/src/components/downloader/queue-table.tsx`

Client component. Props: `jobs: DownloadJob[]`, `onCancel: (id: string) => void`, `onClearFinished: () => void`.

Render a table with columns: Thumbnail | Platform | Creator | Title | Quality | Progress | Status | Actions.

- **Thumbnail**: 40×40px rounded image. If `job.thumbnail` is empty, show a grey placeholder with platform icon.
- **Platform**: small badge — purple "YT" for youtube, pink "IG" for instagram.
- **Creator**: `job.creator || "—"` (muted if empty).
- **Title**: `job.title || job.url` truncated to 40 chars.
- **Quality**: `job.quality`.
- **Progress**: for `downloading` status show a `<Progress>` bar (shadcn) + `{job.speed} · ETA {job.eta}` below it. For other statuses, show nothing or "—".
- **Status**: colored badge:
  - `waiting` → grey "Waiting"
  - `inspecting` → blue "Inspecting..." (with spinner)
  - `downloading` → blue `{job.progress}%` (with spinner)
  - `completed` → green "Done"
  - `failed` → red "Failed" (tooltip with `job.error`)
  - `retrying` → orange `"Retry {job.retryCount}"`
- **Actions**: X button (ghost icon) → calls `onCancel(job.id)`. Only show for non-completed jobs.

Above the table: "Clear Finished" button (ghost, small) aligned right — calls `onClearFinished`.

If queue is empty, show a centered empty state: `Download` icon + "No downloads yet. Add URLs above to get started."

#### `app/src/components/downloader/status-bar.tsx`

Client component. Props: `jobs: DownloadJob[]`.

Fixed bottom bar (sticky at bottom of page, full width, border-t). Show:
- **Total:** `jobs.length`
- **Downloaded:** count where `status === "completed"`
- **Failed:** count where `status === "failed"`
- **Remaining:** count where status is `waiting | inspecting | downloading | retrying`
- **Speed:** sum up `parseFloat(job.speed)` for all downloading jobs, format as `"X.X MB/s total"`. If no active downloads, show `"—"`.

Use `Separator` components (vertical) between stats. Keep it minimal — one line.

---

### Step 8 — Main Page (`app/src/app/downloader/page.tsx`)

Client component (`"use client"`).

State:
- `jobs: DownloadJob[]` — fetched every 2 seconds via `useEffect` polling `GET /api/downloader/queue`
- `activeTab: "urls" | "profile"` — which input method is selected
- `loading: boolean` — adding to queue
- `scraping: boolean` — scraping a profile

Polling effect:
```typescript
useEffect(() => {
  const poll = () => fetch("/api/downloader/queue")
    .then(r => r.json())
    .then(setJobs)
    .catch(() => {});
  poll();
  const id = setInterval(poll, 2000);
  return () => clearInterval(id);
}, []);
```

`handleAddUrls(urls: string[])`:
```typescript
setLoading(true);
await fetch("/api/downloader/queue", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ urls }),
});
setLoading(false);
// polling will update jobs automatically
```

`handleScrapeAndAdd(profileUrl: string, limit?: number)`:
```typescript
setScraping(true);
const res = await fetch("/api/downloader/scrape", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: profileUrl, limit }),
});
const { urls, error } = await res.json();
if (error) { toast.error(error); setScraping(false); return; }
toast.success(`Found ${urls.length} videos`);
await fetch("/api/downloader/queue", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ urls }),
});
setScraping(false);
```

Layout (match existing app style — dark theme, shadcn, Tailwind):
```
<div className="flex flex-col gap-6 pb-16">  {/* pb-16 for status bar */}

  {/* Header */}
  <div>
    <h1 className="text-2xl font-semibold">Downloader</h1>
    <p className="text-sm text-muted-foreground mt-1">
      Download YouTube Shorts and Instagram Reels in bulk
    </p>
  </div>

  {/* Input card */}
  <Card>
    <CardContent className="pt-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="urls">Bulk URLs</TabsTrigger>
          <TabsTrigger value="profile">Creator Profile</TabsTrigger>
        </TabsList>
        <TabsContent value="urls">
          <UrlInputPanel onSubmit={handleAddUrls} loading={loading} />
        </TabsContent>
        <TabsContent value="profile">
          <ProfileInputPanel onSubmit={handleScrapeAndAdd} loading={scraping} />
        </TabsContent>
      </Tabs>
    </CardContent>
  </Card>

  {/* Queue */}
  <QueueTable
    jobs={jobs}
    onCancel={handleCancel}
    onClearFinished={handleClearFinished}
  />

  {/* Status bar — fixed at bottom */}
  <StatusBar jobs={jobs} />
</div>
```

`handleCancel(id)`: POST DELETE to `/api/downloader/queue` with `{ jobId: id }`.
`handleClearFinished()`: POST DELETE to `/api/downloader/queue` with `{}`.

Make `StatusBar` use `className="fixed bottom-0 left-[58px] right-0 ..."` to sit below the icon strip, matching the sidebar width from `layout.tsx`.

---

### Step 9 — Settings Page (`app/src/app/downloader/settings/page.tsx`)

Client component. Load settings from `GET /api/downloader/settings` on mount. Save via `POST /api/downloader/settings`.

Fields to show (use same card/label/input pattern as existing `/settings` page):

| Field | UI | Default |
|---|---|---|
| Download directory | `<Input>` text field | `D:\downloaded videos` |
| Preferred quality | `<Select>`: Best Available / 1080p / 720p | Best Available |
| Concurrent downloads | `<Select>`: 1 / 2 / 3 / 5 / 10 | 3 |
| Retry count | `<Select>`: 0 / 1 / 3 / 5 | 3 |
| Overwrite existing files | `<Switch>` | Off |
| Skip duplicate downloads | `<Switch>` | On |

Note at the bottom: "Instagram cookies are configured in **Settings → Clipping** (yt-dlp Cookies section)" — link to `/settings`.

Save button calls POST with the full settings object. Show a `toast.success("Settings saved")` on success.

---

### Step 10 — Sidebar Update (`components/app-sidebar.tsx`)

Add a new section to the `SECTIONS` array. Import `Download` from lucide-react.

Add this entry **before** the `"clipping"` section:

```typescript
{
  id: "downloader",
  icon: Download,
  label: "Downloader",
  items: [
    { title: "Downloads", href: "/downloader", icon: Download },
    { title: "Settings", href: "/downloader/settings", icon: Settings2 },
  ],
},
```

Update `getSectionFromPath`:
```typescript
if (pathname.startsWith("/downloader")) return "downloader";
```

Update the `SectionId` type (it's derived from `typeof SECTIONS` so it updates automatically).

---

## Data Flow Summary

```
User pastes URLs
  → POST /api/downloader/queue { urls }
  → queueRunner.addJobs(urls) → liveJobs Map + data/download-queue.json
  
Background tick (every 2s):
  → picks waiting jobs up to concurrentDownloads limit
  → per job: inspectUrl() → patch liveJobs → downloadSingleJob() → patch liveJobs
  → on complete/fail: upsertJob() persists to JSON

Browser polls (every 2s):
  → GET /api/downloader/queue
  → queueRunner.getAllJobs() (merge liveJobs + JSON)
  → React state update → UI re-renders
```

---

## File Creation Order

Implement in this order to avoid import errors:

1. `lib/downloader/types.ts`
2. `lib/downloader/store.ts`
3. `lib/downloader/engine.ts`
4. `lib/downloader/scraper.ts`
5. `lib/downloader/queue-runner.ts`
6. `app/api/downloader/queue/route.ts`
7. `app/api/downloader/scrape/route.ts`
8. `app/api/downloader/settings/route.ts`
9. `components/downloader/url-input-panel.tsx`
10. `components/downloader/profile-input-panel.tsx`
11. `components/downloader/queue-table.tsx`
12. `components/downloader/status-bar.tsx`
13. `app/downloader/page.tsx`
14. `app/downloader/settings/page.tsx`
15. `components/app-sidebar.tsx` (add Downloader section)

---

## Important Notes for Implementation

1. **All paths under `app/src/`** — the Next.js app root is `app/src/app/`, components are at `app/src/components/`, lib is at `app/src/lib/`. Every `@/` import alias maps to `app/src/`.

2. **DATA_DIR** = `path.join(process.cwd(), "..", "data")` — same as `lib/settings.ts`. In development, `process.cwd()` is the `app/` directory, so `../data` resolves to the project root `data/`.

3. **Windows paths** — `downloadDir` is a Windows path like `D:\downloaded videos`. Use `path.join()` everywhere and it will resolve correctly on Windows. `mkdirSync` with `{ recursive: true }` will create the full path.

4. **yt-dlp `--write-thumbnail` + `--convert-thumbnails jpg`** — yt-dlp writes the thumbnail as a sibling of the video file with the same base name but `.jpg` extension. No extra handling needed.

5. **Duplicate filename handling** — yt-dlp natively adds ` (1)`, ` (2)` suffixes when `--no-overwrites` is set and a file already exists. Don't implement custom logic.

6. **`uuid` package** — already installed (used in `app/api/clip/route.ts`). Import as `import { v4 as uuid } from "uuid"`.

7. **shadcn components used** — `Card`, `CardContent`, `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Input`, `Textarea`, `Button`, `Select`, `Switch`, `Progress`, `Badge` are all already installed. Check `components/ui/` before installing anything new.

8. **The `queueRunner` singleton** — because Next.js hot-reloads modules in development, `setInterval` may fire from stale module instances. Wrap `ensureStarted()` with a check on `global.__dlRunner` to survive hot-reloads:

```typescript
// At bottom of queue-runner.ts
declare global { var __dlRunner: QueueRunner | undefined; }
export const queueRunner: QueueRunner = global.__dlRunner ?? (global.__dlRunner = new QueueRunner());
```

9. **`maxDuration`** — set `export const maxDuration = 300` on the queue API route since downloads can take several minutes.

10. **Status bar position** — the sidebar icon strip is 58px wide. Use `style={{ left: 58 }}` on the fixed status bar so it doesn't overlap the sidebar.
