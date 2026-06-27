"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScheduleModal } from "@/components/clip/schedule-modal";
import {
  Calendar,
  Download,
  Scissors,
  Play,
  Loader2,
  Sparkles,
  X,
  ArrowLeft,
} from "lucide-react";
import type { Clip, ClipJob } from "@/lib/types";

const ACTIVE_STATUSES = new Set(["idle", "downloading", "transcribing", "selecting", "rendering"]);

function scoreColor(score: number): string {
  if (score >= 75) return "text-foreground";
  if (score >= 60) return "text-foreground/70";
  return "text-muted-foreground";
}

export default function JobResultsPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [job, setJob] = useState<ClipJob | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleClip, setScheduleClip] = useState<Clip | null>(null);
  const [hookDismissed, setHookDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clip/${jobId}`);
      if (res.ok) {
        const data = (await res.json()) as { job: ClipJob; clips: Clip[] };
        setJob(data.job);
        setClips(data.clips);
      }
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the job is still processing.
  useEffect(() => {
    if (!job || !ACTIVE_STATUSES.has(job.status)) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [job, load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-md text-center space-y-3 pt-16">
        <p className="text-muted-foreground">This clip project could not be found.</p>
        <Link href="/clip" className="text-primary hover:underline">← New Clip</Link>
      </div>
    );
  }

  const processing = ACTIVE_STATUSES.has(job.status);

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href="/clip/projects" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Projects
          </Link>
          <h1 className="truncate text-2xl font-bold tracking-tight">{job.sourceTitle}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {job.clipModel} · {job.captionPreset} · {job.aspectRatio}
            {clips.length > 0 && ` · ${clips.length} clips`}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/clip">
            <Scissors className="h-4 w-4" /> New Clip
          </Link>
        </Button>
      </div>

      {/* Processing banner */}
      {processing && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium capitalize">{job.status}…</p>
            <p className="text-xs text-muted-foreground">
              This page refreshes automatically. You can leave and come back.
            </p>
          </div>
        </div>
      )}

      {/* Error banner */}
      {job.status === "error" && job.errors.length > 0 && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4">
          <p className="text-sm font-medium text-destructive">Processing failed</p>
          {job.errors.map((e, i) => (
            <p key={i} className="mt-1 text-xs text-muted-foreground">{e}</p>
          ))}
        </div>
      )}

      {/* Canceled banner */}
      {job.status === "canceled" && (
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/40 px-5 py-4">
          <div>
            <p className="text-sm font-medium">Job canceled</p>
            <p className="text-xs text-muted-foreground">
              You stopped this job{clips.length > 0 ? " — any clips finished before that are below." : "."}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/clip">
              <Scissors className="h-4 w-4" /> New Clip
            </Link>
          </Button>
        </div>
      )}

      {/* Auto-hook info banner */}
      {job.autoHook && clips.length > 0 && !hookDismissed && (
        <div className="flex items-start justify-between gap-4 rounded-xl border bg-card px-5 py-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">Auto hook</p>
              <p className="text-xs text-muted-foreground">
                A text hook was added to the first 5 seconds of each clip.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => setHookDismissed(true)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Clip grid */}
      {clips.length === 0 && !processing ? (
        <p className="text-sm text-muted-foreground">No clips were produced.</p>
      ) : (
        <>
          {clips.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Original clips</span>
              <span className="text-muted-foreground">({clips.length})</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {clips.map((clip) => (
              <ClipCard key={clip.id} clip={clip} onSchedule={() => setScheduleClip(clip)} />
            ))}
          </div>
        </>
      )}

      {scheduleClip && (
        <ScheduleModal clip={scheduleClip} onClose={() => setScheduleClip(null)} />
      )}
    </div>
  );
}

function ClipCard({ clip, onSchedule }: { clip: Clip; onSchedule: () => void }) {
  const [playing, setPlaying] = useState(false);

  return (
    <Card className="group gap-0 overflow-hidden p-0">
      <div className="relative aspect-[9/16] bg-black">
        {playing ? (
          <video
            src={`/api/clip/media/${clip.id}`}
            controls
            autoPlay
            className="h-full w-full object-contain"
          />
        ) : (
          <button onClick={() => setPlaying(true)} className="relative h-full w-full">
            {clip.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/clip/thumb/${clip.id}`}
                alt={clip.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                <Play className="h-8 w-8" />
              </div>
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
              <Play className="h-10 w-10 text-white drop-shadow" />
            </span>
            <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {Math.floor(clip.durationSec / 60)}:{String(Math.round(clip.durationSec % 60)).padStart(2, "0")}
            </span>
          </button>
        )}
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <span className={`text-2xl font-bold ${scoreColor(clip.score)}`}>{clip.score}</span>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon-sm" onClick={onSchedule} title="Schedule">
              <Calendar className="h-4 w-4" />
            </Button>
            <Button asChild variant="ghost" size="icon-sm" title="Download">
              <a href={`/api/clip/download/${clip.id}`}>
                <Download className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild variant="ghost" size="icon-sm" title="Edit clip">
              <Link href={`/clip/${clip.jobId}/${clip.id}/edit`}>
                <Scissors className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <p className="line-clamp-2 text-sm font-medium leading-snug">{clip.title}</p>

        <div className="flex flex-wrap gap-1">
          {clip.hookType && <Badge variant="outline" className="text-[10px]">{clip.hookType}</Badge>}
          {clip.genre && <Badge variant="ghost" className="text-[10px] text-muted-foreground">{clip.genre}</Badge>}
        </div>
      </div>
    </Card>
  );
}
