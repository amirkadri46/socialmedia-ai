# Plan: Opus-Style Long-Video → Viral Clips Pipeline

**Created:** 2026-06-19
**Status:** Draft
**Request:** Add an Opus.pro-style clipping feature to the existing app — paste a long video URL (YouTube, podcast, etc.), automatically find the most viral moments, cut them into vertical 9:16 clips with animated captions, and browse/export the results. This is the production engine behind a clipping agency.

---

## Overview

### What This Plan Accomplishes

Adds a second pipeline alongside the existing competitor-analysis one. Where the current pipeline *studies* other people's reels, this one *produces* finished short-form clips from a single long source video. A user pastes a link on a new `/clip` page, the app downloads the video, transcribes it, asks an LLM which segments will perform best, cuts them, reframes to vertical, burns in captions, and lists the resulting clips for download — the core OpusClip workflow.

### Why This Matters

This is the deliverable a clipping agency actually sells. The current repo already has the hard infrastructure (Next.js streaming pipeline, Gemini video analysis, OpenAI/Claude text generation, CSV storage, settings-managed API keys). The clipper reuses all of it and adds a video-processing layer. Shipping this turns the project from a research tool into a revenue tool: take one client podcast episode in, get 15 ready-to-post clips out.

### Scope Boundary (read this first)

The genuinely hard 20% is **auto-reframe with active-speaker tracking** (keeping the talking person centered when cropping 16:9 → 9:16). This plan ships a **center/face-anchored crop in v1** and treats speaker-tracking as a clearly separated v2 milestone. Everything else (download, transcribe, moment selection, cutting, captions) is well-trodden and reuses existing patterns.

---

## Current State

### Relevant Existing Structure

- `app/src/lib/pipeline.ts` — orchestration with `runWithConcurrency` + `onProgress` streaming callback. Direct template for the clip orchestrator.
- `app/src/lib/gemini.ts` — `uploadVideo` + `analyzeVideo` (multimodal video understanding). Reusable for scoring/ranking moments and for video-level QA.
- `app/src/lib/claude.ts` / `openai` dep — text generation pattern for the moment-selection prompt.
- `app/src/lib/settings.ts` — runtime API-key/model resolution. New keys (transcription provider) go here.
- `app/src/lib/csv.ts` — read/write helpers. New `clips.csv` follows the same shape as `videos.csv`.
- `app/src/lib/types.ts` — central interfaces; add `Clip`, `ClipJob`, `ClipProgress`, `Moment`.
- `app/src/app/run/page.tsx` + `app/src/context/pipeline-context.tsx` — live-progress streaming UI. Template for `/clip` page.
- `app/src/app/api/pipeline/route.ts` — streaming API route pattern (SSE/ReadableStream). Template for `/api/clip`.
- `app/src/components/app-sidebar.tsx` — add a "Clip" nav entry.

### Gaps or Problems Being Addressed

- No way to ingest a long-form video from a URL (only Apify reel scraping exists).
- No audio transcription anywhere in the stack.
- No `ffmpeg`-based cutting, cropping, or caption burning.
- No data model or UI for produced (vs. analyzed) clips.

### Key Constraint: Heavy Work Runs Out-of-Band

Downloading + transcribing + ffmpeg on a 60-min video takes minutes and is CPU/IO heavy. It must NOT run inside a normal Next.js request. Options, simplest first:
1. **v1:** run it inside the streaming route as a background async job keyed by `clipJobId`, with progress pushed over the existing streaming pattern (acceptable for a single-user local app — same model the current pipeline already uses).
2. **v2 (scale):** move to a separate worker process / queue (BullMQ + Redis) so the UI and processing are decoupled.

---

## Proposed Changes

### New Dependencies

- **yt-dlp** — video download from URL. Invoke as a CLI binary via `child_process` (most reliable) rather than a JS wrapper.
- **ffmpeg / ffprobe** — cutting, cropping, scaling, caption burning. CLI via `child_process`. Bundle with `ffmpeg-static` + `ffprobe-static` npm packages so it works cross-platform without a system install.
- **Transcription** — choose one:
  - *Cloud (recommended for v1):* Deepgram or AssemblyAI — fast, returns word-level timestamps directly. One API call.
  - *Local (zero marginal cost):* `whisper.cpp` or `faster-whisper` via CLI. Slower, no per-minute fee.
- *(v2 reframe)* `@mediapipe/tasks-vision` or a Python sidecar (OpenCV + face detection) for active-speaker tracking.

### New Library Modules (`app/src/lib/clip/`)

Keep them small and single-purpose so each can be tested in isolation:

- `download.ts` — `downloadVideo(url): Promise<{ path, durationSec, title, width, height }>`. Wraps `yt-dlp`; saves to a temp dir; returns metadata via `ffprobe`.
- `transcribe.ts` — `transcribe(path): Promise<Word[]>` where `Word = { text, start, end }`. Provider behind a settings flag.
- `moments.ts` — `selectMoments(words, opts): Promise<Moment[]>`. Builds a timestamped transcript string, sends it to the LLM (reuse `claude.ts`/openai), parses a JSON array of `{ start, end, title, hook, score, reason }`. Prompt is **config-driven** exactly like the existing `analysisInstruction` / `newConceptsInstruction` pattern, so the agency can tune "what makes a good clip" per client.
- `cut.ts` — `cutClip(srcPath, start, end): Promise<string>`. `ffmpeg -ss/-to`, re-encode for frame-accurate cuts.
- `reframe.ts` — `reframe(path): Promise<string>`. **v1:** scale + center crop to 1080×1920 (`crop`/`scale` filters), optionally anchored to a face detected on a sample frame. **v2:** per-segment speaker-tracked dynamic crop.
- `captions.ts` — `burnCaptions(path, words, style): Promise<string>`. Generate a word-timed `.ass` subtitle file (karaoke/highlight style) from the transcript slice, burn in with `ffmpeg -vf ass=...`.
- `clipPipeline.ts` — orchestrator mirroring `pipeline.ts`: download → transcribe → selectMoments → for each moment (cut → reframe → captions) → write `clips.csv`, emitting `ClipProgress` through `onProgress`.

### Pipeline Flow

```
URL
 └─ download.ts        → source.mp4 + metadata
 └─ transcribe.ts      → word-level transcript
 └─ moments.ts (LLM)   → ranked [{start,end,title,hook,score}]
 └─ for each top-K moment:
      cut.ts           → segment.mp4
      reframe.ts       → vertical.mp4 (v1: center/face crop)
      captions.ts      → captioned.mp4  (final)
 └─ csv.ts             → append rows to clips.csv
```

### Data Model (`types.ts` additions)

```ts
export interface Word { text: string; start: number; end: number; }

export interface Moment {
  start: number; end: number;
  title: string; hook: string;
  score: number;            // 0–100 virality estimate from LLM
  reason: string;
}

export interface Clip {
  id: string;
  jobId: string;
  sourceUrl: string;
  sourceTitle: string;
  title: string;
  start: number; end: number;
  durationSec: number;
  score: number;
  filePath: string;         // path to final captioned vertical mp4
  thumbnail: string;
  createdAt: string;
  starred: boolean;
}

export interface ClipProgress {
  jobId: string;
  status: "idle" | "downloading" | "transcribing" | "selecting" | "rendering" | "done" | "error";
  sourceTitle?: string;
  momentsTotal: number;
  clipsRendered: number;
  log: string[];
  errors: string[];
}
```

### New API Route

- `app/src/app/api/clip/route.ts` — `POST { url, topK, captionStyle, configName }`. Streams `ClipProgress` using the same `ReadableStream` pattern as `api/pipeline/route.ts`. Reuses the settings + CSV layer.

### New UI

- `app/src/app/clip/page.tsx` — URL input, top-K slider, caption-style picker, live progress (reuse the `run/page.tsx` + `pipeline-context.tsx` streaming components), and a grid of finished clips with inline video preview + download button.
- Extend `videos/page.tsx` patterns for the clip grid, or add a `/clips` browse page backed by `clips.csv`.
- Add "Clip" to `app-sidebar.tsx`.

### Settings additions (`settings.ts` + `/settings`)

- Transcription provider + key (`DEEPGRAM_API_KEY` / `ASSEMBLYAI_API_KEY`) or local-whisper toggle.
- Default top-K, default caption style, min/max clip length.

---

## Implementation Milestones

1. **Plumbing** — add `yt-dlp` + `ffmpeg-static`; `download.ts` returns a playable file + metadata. *Done when:* paste a YouTube URL, get `source.mp4` on disk.
2. **Transcription** — `transcribe.ts` returns word-level timestamps from the downloaded file. *Done when:* console-log an accurate timed transcript.
3. **Moment selection** — `moments.ts` LLM call returns a ranked JSON list of segments; prompt stored as a config. *Done when:* sensible `{start,end,hook,score}` array for a real video.
4. **Cut + naive reframe + captions** — produce a finished vertical, captioned clip for one moment (center crop). *Done when:* one post-ready 9:16 mp4 exists.
5. **Orchestrate + persist** — `clipPipeline.ts` runs all moments with concurrency control, writes `clips.csv`, streams progress. *Done when:* one URL → N clips + rows in CSV.
6. **UI** — `/clip` page end-to-end with live progress and a clip grid. *Done when:* whole flow works from the browser.
7. **(v2) Speaker-tracked reframe** — dynamic crop that follows the active speaker. Isolated; ship only after 1–6 validate the business.

---

## Testing & Verification

- **Unit-ish:** run each lib module from a throwaway script against a short (2–3 min) public video before wiring the UI.
- **ffmpeg correctness:** verify output is exactly 1080×1920, audio in sync, captions aligned to spoken words (eyeball 2–3 clips).
- **Moment quality:** compare LLM-picked moments against a manual pick on a known video; tune the prompt.
- **Cost/time log:** record download+transcribe+render seconds and any per-minute API cost per job — this is your agency unit economics.
- **Failure paths:** private/age-gated/region-locked URLs, videos with no speech, very long (2h+) inputs.

---

## Risks & Notes

- **Auto-reframe is the moat and the hard part.** Don't block v1 on it; center crop is fine to validate demand. OpusClip's perceived quality is largely speaker tracking + caption polish.
- **yt-dlp + ToS.** Downloading third-party video has platform-ToS implications; for the agency, clients supply their own footage/upload, which sidesteps most of it. Keep an upload path alongside the URL path.
- **Render time** dominates UX. Cut before reframe/caption, parallelize per-clip rendering with the existing `runWithConcurrency`, and consider a queue at scale.
- **Caption styling** (font, highlight color, word-by-word pop) is disproportionately important to perceived quality — invest in the `.ass` template.
- **Frame-accurate cuts** require re-encoding (`-ss` after `-i`), not stream-copy; budget CPU accordingly.

---

## Out of Scope (this plan)

- Crayo-style fully-synthetic faceless videos (TTS + gameplay background) — separate pipeline, can reuse `captions.ts` and `clipPipeline.ts` scaffolding later.
- Direct auto-posting to TikTok/Reels/Shorts.
- Multi-tenant client accounts / billing.
