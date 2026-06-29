"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Scissors,
  Link2,
  Upload,
  Sparkles,
  Loader2,
  Ban,
} from "lucide-react";
import type { ClipProgress } from "@/lib/types";
import { CAPTION_STYLES } from "@/lib/clip/caption-styles";
import { CaptionPreview } from "@/components/clip/caption-preview";

const CLIP_MODELS = ["ClipBasic", "ClipAdvanced", "Auto"];
const GENRES = ["Auto", "Talking & podcast", "Journey & tutorial", "Hot take", "Story", "Educational"];
const CLIP_LENGTHS = ["Auto (0-3m)", "<30s", "30s-60s", "60s-90s"];
const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Hindi", "Hinglish"];
const ASPECT_RATIOS = ["9:16", "1:1", "16:9"];

// Background-safe clipping: the New Clip form + any running job survive navigation.
// Form/preview state is cached in sessionStorage; the active job id lets us re-attach
// to a pipeline that keeps running server-side. A job only stops when the user cancels.
const DRAFT_KEY = "clip:newClipDraft";
const ACTIVE_JOB_KEY = "clip:activeJobId";
const TERMINAL_STATUSES = new Set(["done", "error", "canceled"]);

interface SourceMeta {
  title: string;
  durationSec: number;
  thumbnail: string;
  width: number;
  height: number;
  sizeBytes?: number;
}

// Coarse percent when only a persisted job status is available (no live progress —
// e.g. after a server restart). Live progress from the store is preferred when present.
const STATUS_PERCENT: Record<string, number> = {
  idle: 0,
  downloading: 12,
  transcribing: 30,
  selecting: 45,
  rendering: 70,
  done: 100,
  error: 0,
  canceled: 0,
};

function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** Build a minimal progress snapshot from a persisted job when no live progress exists. */
function synthProgress(job: {
  id: string;
  status: string;
  sourceTitle?: string;
  errors?: string[];
}): ClipProgress {
  return {
    jobId: job.id,
    status: job.status as ClipProgress["status"],
    sourceTitle: job.sourceTitle,
    percent: STATUS_PERCENT[job.status] ?? 0,
    momentsTotal: 0,
    clipsRendered: 0,
    log: [],
    errors: job.errors ?? [],
  };
}

export default function NewClipPage() {
  const router = useRouter();

  // ── Source state ──────────────────────────────────────────────────────────────
  const [url, setUrl] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [meta, setMeta] = useState<SourceMeta | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Config state ──────────────────────────────────────────────────────────────
  const [clipModel, setClipModel] = useState("ClipBasic");
  const [genre, setGenre] = useState("Auto");
  const [clipLengthMode, setClipLengthMode] = useState("Auto (0-3m)");
  const [autoHook, setAutoHook] = useState(true);
  const [captionPreset, setCaptionPreset] = useState("Karaoke");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [speechLanguage, setSpeechLanguage] = useState("English");
  const [includeMomentsPrompt, setIncludeMomentsPrompt] = useState("");
  const [topK, setTopK] = useState(6);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [dontClip, setDontClip] = useState(false);

  // ── Processing state ──────────────────────────────────────────────────────────
  const [progress, setProgress] = useState<ClipProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState("");
  // True when we re-attached to a job that was started before this mount (e.g. after
  // navigating away and back) — drives polling instead of the live SSE stream.
  const [reconnecting, setReconnecting] = useState(false);
  // Gates the draft-persist effect until the saved draft has been read AND applied to
  // state — otherwise the persist effect's first run would write default values back
  // over the draft we just restored.
  const [restored, setRestored] = useState(false);

  const mountedRef = useRef(true);
  const runAbortRef = useRef<AbortController | null>(null);

  // For uploads, duration is probed server-side, so it stays 0 here (timeframe slider hidden).
  const durationSec = meta?.durationSec || 0;

  const clearActiveJob = () => {
    try {
      sessionStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      /* sessionStorage unavailable */
    }
  };

  // ── Restore form + reconnect to any running job (once, on mount) ────────────────
  useEffect(() => {
    mountedRef.current = true;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.url) setUrl(d.url);
        if (d.meta) setMeta(d.meta);
        if (d.clipModel) setClipModel(d.clipModel);
        if (d.genre) setGenre(d.genre);
        if (d.clipLengthMode) setClipLengthMode(d.clipLengthMode);
        if (typeof d.autoHook === "boolean") setAutoHook(d.autoHook);
        if (d.captionPreset) setCaptionPreset(d.captionPreset);
        if (d.aspectRatio) setAspectRatio(d.aspectRatio);
        if (d.speechLanguage) setSpeechLanguage(d.speechLanguage);
        if (typeof d.includeMomentsPrompt === "string") setIncludeMomentsPrompt(d.includeMomentsPrompt);
        if (typeof d.topK === "number") setTopK(d.topK);
        if (typeof d.rangeStart === "number") setRangeStart(d.rangeStart);
        if (typeof d.rangeEnd === "number") setRangeEnd(d.rangeEnd);
        if (typeof d.dontClip === "boolean") setDontClip(d.dontClip);
      }
    } catch {
      /* ignore malformed draft */
    }

    let jobId = "";
    try {
      jobId = sessionStorage.getItem(ACTIVE_JOB_KEY) || "";
    } catch {
      /* ignore */
    }
    if (jobId) {
      // Only re-attach if the job is still running. A terminal job left a stale key
      // (e.g. after "Run in background" or closing the tab) — clear it and show a fresh
      // form rather than yanking the user into an old job's results.
      (async () => {
        try {
          const res = await fetch(`/api/clip/${jobId}`);
          if (!res.ok) {
            clearActiveJob();
            return;
          }
          const data = await res.json();
          const status: string | undefined = data?.job?.status;
          if (!status || TERMINAL_STATUSES.has(status)) {
            clearActiveJob();
            return;
          }
          if (!mountedRef.current) return;
          setActiveJobId(jobId);
          setReconnecting(true);
          setRunning(true);
          setProgress(
            (data.progress as ClipProgress | null) ?? {
              jobId,
              status: "downloading",
              percent: 0,
              momentsTotal: 0,
              clipsRendered: 0,
              log: ["Reconnecting to your job…"],
              errors: [],
            }
          );
        } catch {
          /* network hiccup — leave the key so a later visit can retry */
        }
      })();
    }
    setRestored(true);

    return () => {
      mountedRef.current = false;
      runAbortRef.current?.abort();
    };
  }, []);

  // ── Persist the form draft so navigating away never loses fetched video/config ──
  useEffect(() => {
    if (!restored) return; // don't clobber the saved draft before restore applies
    const draft = {
      url,
      meta: uploadFile ? null : meta, // uploaded File can't be serialized; URL preview can
      clipModel,
      genre,
      clipLengthMode,
      autoHook,
      captionPreset,
      aspectRatio,
      speechLanguage,
      includeMomentsPrompt,
      topK,
      rangeStart,
      rangeEnd,
      dontClip,
    };
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* sessionStorage unavailable / quota */
    }
  }, [
    restored, url, meta, uploadFile, clipModel, genre, clipLengthMode, autoHook,
    captionPreset, aspectRatio, speechLanguage, includeMomentsPrompt,
    topK, rangeStart, rangeEnd, dontClip,
  ]);

  // ── Reconnect: poll a running job we re-attached to (no live SSE in this tab) ────
  useEffect(() => {
    if (!reconnecting || !activeJobId) return;
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/clip/${activeJobId}`);
        if (!res.ok) {
          // Job record gone — nothing to watch.
          if (!stopped && mountedRef.current) {
            setReconnecting(false);
            setRunning(false);
            clearActiveJob();
          }
          return;
        }
        const data = await res.json();
        const job = data.job as { id: string; status: string; sourceTitle?: string; errors?: string[] };
        const live = (data.progress as ClipProgress | null) ?? synthProgress(job);
        if (!mountedRef.current) return;
        setProgress(live);

        if (TERMINAL_STATUSES.has(job.status)) {
          stopped = true;
          clearActiveJob();
          if (job.status === "done") {
            router.push(`/clip/${activeJobId}`);
          } else {
            setReconnecting(false);
            setRunning(false);
            if (job.status === "error") setError((job.errors ?? [])[0] || "Processing failed.");
          }
        }
      } catch {
        /* transient network error — keep polling */
      }
    };

    poll();
    const t = setInterval(poll, 2500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [reconnecting, activeJobId, router]);

  async function handleInspect() {
    if (!/^https?:\/\//.test(url)) {
      setError("Enter a valid http(s) video URL.");
      return;
    }
    setError("");
    setInspecting(true);
    try {
      const res = await fetch("/api/clip/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to inspect URL.");
      setMeta(data);
      setRangeStart(0);
      setRangeEnd(data.durationSec || 0);
      setUploadFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to inspect URL.");
    } finally {
      setInspecting(false);
    }
  }

  function handleFile(file: File) {
    setUploadFile(file);
    setMeta({ title: file.name.replace(/\.[^.]+$/, ""), durationSec: 0, thumbnail: "", width: 0, height: 0 });
    setUrl("");
    setError("");
  }

  function buildJobPayload(jobId: string) {
    return {
      id: jobId,
      sourceUrl: uploadFile ? undefined : url,
      sourceTitle: meta?.title || "Untitled video",
      sourceDurationSec: durationSec,
      sourceThumbnail: meta?.thumbnail,
      clipModel,
      genre,
      clipLengthMode,
      autoHook,
      captionPreset,
      aspectRatio,
      speechLanguage,
      includeMomentsPrompt,
      topK,
      rangeStartSec: rangeStart,
      rangeEndSec: rangeEnd,
    };
  }

  async function handleRun() {
    // Generate the job id up front so we can persist it immediately — the pipeline runs
    // detached server-side, so even if this tab navigates away the job keeps going and
    // we can re-attach on return.
    const jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setActiveJobId(jobId);
    setReconnecting(false);
    try {
      sessionStorage.setItem(ACTIVE_JOB_KEY, jobId);
    } catch {
      /* sessionStorage unavailable */
    }

    setRunning(true);
    setError("");
    setProgress({
      jobId,
      status: "downloading",
      sourceTitle: meta?.title,
      percent: 0,
      momentsTotal: 0,
      clipsRendered: 0,
      log: ["Starting…"],
      errors: [],
    });

    const controller = new AbortController();
    runAbortRef.current = controller;

    try {
      let res: Response;
      const job = buildJobPayload(jobId);
      if (uploadFile) {
        const form = new FormData();
        form.append("job", JSON.stringify(job));
        form.append("file", uploadFile);
        res = await fetch("/api/clip", { method: "POST", body: form, signal: controller.signal });
      } else {
        res = await fetch("/api/clip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(job),
          signal: controller.signal,
        });
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      let lastStatus = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as ClipProgress;
              lastStatus = data.status;
              if (mountedRef.current) setProgress(data);
              if (TERMINAL_STATUSES.has(data.status)) {
                clearActiveJob();
                if (data.status === "done" && data.jobId && mountedRef.current) {
                  router.push(`/clip/${data.jobId}`);
                  return;
                }
                if (data.status === "error" && mountedRef.current) {
                  setError((data.errors ?? [])[0] || "Pipeline failed.");
                  setRunning(false);
                }
                if (data.status === "canceled" && mountedRef.current) {
                  setRunning(false);
                }
              }
            } catch {
              /* skip non-JSON keepalive lines */
            }
          }
        }
      }
      // Stream ended without a terminal event (e.g. server timeout) — the job may still
      // be running server-side. Hand off to the results page, which keeps polling.
      if (mountedRef.current && !controller.signal.aborted && !TERMINAL_STATUSES.has(lastStatus)) {
        router.push(`/clip/${jobId}`);
      }
    } catch (e) {
      // An abort means this tab navigated away; the server job keeps running and we'll
      // re-attach on return, so don't surface it as an error or clear the active job.
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Pipeline failed.");
      setRunning(false);
      clearActiveJob();
    }
  }

  /** Explicitly cancel the running job — the only thing that stops it. */
  async function handleCancel() {
    const id = activeJobId || progress?.jobId;
    if (!id) {
      setRunning(false);
      return;
    }
    try {
      await fetch(`/api/clip/${id}/cancel`, { method: "POST" });
    } catch {
      /* best-effort; the pipeline checks the flag at its next step */
    }
    runAbortRef.current?.abort();
    clearActiveJob();
    setReconnecting(false);
    setRunning(false);
  }

  /** Close the modal but let the job keep running in the background. */
  function handleRunInBackground() {
    runAbortRef.current?.abort(); // stop streaming to this tab; server job continues
    const id = activeJobId || progress?.jobId;
    // The results page tracks the job by id on its own, so the reconnect key isn't
    // needed once we hand off — clearing it avoids re-attaching to this (finished) job
    // the next time the user opens New Clip.
    clearActiveJob();
    if (id) {
      router.push(`/clip/${id}`); // results page keeps polling + shows progress
    } else {
      setRunning(false);
    }
  }

  const canRun = (!!uploadFile || (!!meta && !!url)) && !running;

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <div>
        <div className="flex items-center gap-2">
          <Scissors className="h-5 w-5 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">New Clip</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a long video link or upload a file — get back ranked, captioned 9:16 clips.
        </p>
      </div>

      {/* ── Source card ──────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4">
        <div className="flex items-center gap-2 rounded-md border bg-background px-3">
          <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInspect()}
            placeholder="Drop a video link (YouTube, podcast, Rumble…)"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-12 px-0"
            disabled={running}
          />
          {(meta || uploadFile) && (
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setMeta(null);
                setUrl("");
                setUploadFile(null);
              }}
              className="text-muted-foreground"
            >
              Remove
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleInspect}
            disabled={inspecting || running || !url}
            variant="outline"
          >
            {inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch video"}
          </Button>
          <span className="text-xs text-muted-foreground">or</span>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={running}
          >
            <Upload className="h-4 w-4" /> Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Button
            variant="outline"
            disabled
            title="Coming soon"
          >
            Google Drive
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Fetched preview */}
        {meta && (
          <div className="flex gap-4 rounded-md bg-muted/50 p-4 border">
            {meta.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.thumbnail} alt="" className="h-24 w-40 rounded-md object-cover" />
            ) : (
              <div className="flex h-24 w-40 items-center justify-center rounded-md bg-muted">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium line-clamp-2">{meta.title}</p>
              {meta.durationSec > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Duration {fmtClock(meta.durationSec)}
                  {meta.width ? ` · ${meta.width}×${meta.height}` : ""}
                  {meta.sizeBytes ? ` · ~${fmtBytes(meta.sizeBytes)}` : ""}
                </p>
              )}
              {uploadFile && (
                <p className="mt-1 text-xs text-muted-foreground">Uploaded file · {(uploadFile.size / 1e6).toFixed(1)} MB</p>
              )}
            </div>
          </div>
        )}
        </CardContent>
      </Card>

      {/* ── Configure card ──────────────────────────────────────────────────── */}
      {(meta || uploadFile) && (
        <Card>
          <CardContent className="space-y-6">
          <Tabs value={dontClip ? "dont" : "ai"} onValueChange={(v) => setDontClip(v === "dont")}>
            <TabsList>
              <TabsTrigger value="ai">
                <Sparkles className="h-3.5 w-3.5" /> AI clipping
              </TabsTrigger>
              <TabsTrigger value="dont">
                <Ban className="h-3.5 w-3.5" /> Don&apos;t clip
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ai" className="space-y-6 pt-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Clip model">
                  <PickSelect value={clipModel} onChange={setClipModel} options={CLIP_MODELS} />
                </Field>
                <Field label="Genre">
                  <PickSelect value={genre} onChange={setGenre} options={GENRES} />
                </Field>
                <Field label="Clip length">
                  <PickSelect value={clipLengthMode} onChange={setClipLengthMode} options={CLIP_LENGTHS} />
                </Field>
                <Field label="Number of clips">
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={topK}
                    onChange={(e) => setTopK(Math.max(1, Math.min(20, Number(e.target.value))))}
                  />
                </Field>
              </div>

              <div className="flex items-center justify-between rounded-md bg-muted/50 px-4 py-3 border">
                <div>
                  <p className="text-sm font-medium">Auto hook</p>
                  <p className="text-[11px] text-muted-foreground">Add a text hook to the first 5 seconds of each clip.</p>
                </div>
                <Switch checked={autoHook} onCheckedChange={setAutoHook} />
              </div>

              <Field label="Include specific moments (optional)">
                <Textarea
                  value={includeMomentsPrompt}
                  onChange={(e) => setIncludeMomentsPrompt(e.target.value)}
                  rows={2}
                  placeholder="e.g. anything about pricing, the founder story, or the 3-step framework"
                  className="resize-none"
                />
              </Field>

              {/* Processing timeframe */}
              {durationSec > 0 && (
                <Field label={`Processing timeframe — ${fmtClock(rangeStart)} to ${fmtClock(rangeEnd || durationSec)}${
                  meta?.sizeBytes && durationSec
                    ? ` · ~${fmtBytes(meta.sizeBytes * (((rangeEnd || durationSec) - rangeStart) / durationSec))}`
                    : ""
                }`}>
                  <div className="pt-3">
                    <Slider
                      min={0}
                      max={durationSec}
                      step={1}
                      value={[rangeStart, rangeEnd || durationSec]}
                      onValueChange={([start, end]) => {
                        setRangeStart(Math.min(start, end - 1));
                        setRangeEnd(Math.max(end, start + 1));
                      }}
                    />
                  </div>
                </Field>
              )}
            </TabsContent>

            <TabsContent value="dont" className="pt-4">
              <p className="text-sm text-muted-foreground">
                Passthrough mode — reframe and caption the whole video without AI moment selection. (v1 still renders the top moment.)
              </p>
            </TabsContent>
          </Tabs>

          {/* Caption preset gallery (with live preview) */}
          <div className="space-y-3 border-t pt-5">
            <Label className="text-xs text-muted-foreground">Caption preset — pick a subtitle style</Label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {CAPTION_STYLES.map((s) => (
                <CaptionPreview
                  key={s.name}
                  style={s}
                  selected={captionPreset === s.name}
                  onSelect={() => setCaptionPreset(s.name)}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <Field label="Aspect ratio">
                <PickSelect value={aspectRatio} onChange={setAspectRatio} options={ASPECT_RATIOS} />
              </Field>
              <Field label="Speech language">
                <PickSelect value={speechLanguage} onChange={setSpeechLanguage} options={LANGUAGES} />
              </Field>
            </div>
          </div>

          <Button
            onClick={handleRun}
            disabled={!canRun}
            size="lg"
            className="w-full h-12 text-base"
          >
            <Sparkles className="h-4 w-4" /> Get clips in 1 click
          </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Processing overlay (Screen 3) ───────────────────────────────────── */}
      {running && progress && (
        <ProcessingModal
          progress={progress}
          reconnecting={reconnecting}
          onRunInBackground={handleRunInBackground}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function PickSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ProcessingModal({
  progress,
  reconnecting,
  onRunInBackground,
  onCancel,
}: {
  progress: ClipProgress;
  reconnecting: boolean;
  onRunInBackground: () => void;
  onCancel: () => void;
}) {
  const etaMin = progress.etaSeconds ? Math.ceil(progress.etaSeconds / 60) : null;
  return (
    // Keep the job running in the background when the modal is dismissed (no auto-cancel).
    <Dialog open onOpenChange={(o) => !o && onRunInBackground()}>
      <DialogContent className="max-w-xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {reconnecting ? "Reconnected to your processing job" : "Your video is processing"}
          </DialogTitle>
          <DialogDescription>
            This keeps running in the background even if you leave — it only stops if you cancel.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted p-4 font-mono text-sm space-y-2 max-h-72 overflow-auto">
          <p>
            Fetching video <span className="text-primary">&quot;{progress.sourceTitle}&quot;</span>
          </p>
          {progress.curationMethod && <p>Curation method: {progress.curationMethod}…</p>}
          {progress.rangeLabel && <p className="text-muted-foreground">{progress.rangeLabel}</p>}
          {etaMin && <p className="text-muted-foreground">Estimated waiting time: ~{etaMin}min</p>}
          <p className="text-primary font-medium">
            {progress.status === "done"
              ? "Done!"
              : progress.status === "canceled"
                ? "Canceled."
                : `Processing & analyzing… ${progress.percent}%`}
          </p>
          {progress.log.slice(-6).map((l, i) => (
            <p key={i} className="text-muted-foreground/70 text-xs">{l}</p>
          ))}
          {progress.errors.map((e, i) => (
            <p key={i} className="text-destructive text-xs">{e}</p>
          ))}
        </div>

        <Progress value={progress.percent} />

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onCancel} className="text-destructive hover:text-destructive">
            Cancel job
          </Button>
          <Button variant="outline" onClick={onRunInBackground}>
            Run in background
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
