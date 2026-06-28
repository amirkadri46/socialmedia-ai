"use client";

import { Download, X, Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DownloadJob } from "@/lib/downloader/types";

function PlatformBadge({ platform }: { platform: DownloadJob["platform"] }) {
  if (platform === "youtube")
    return <Badge className="bg-purple-500/15 text-purple-300 hover:bg-purple-500/15">YT</Badge>;
  if (platform === "instagram")
    return <Badge className="bg-pink-500/15 text-pink-300 hover:bg-pink-500/15">IG</Badge>;
  return <Badge variant="secondary">?</Badge>;
}

function StatusBadge({ job }: { job: DownloadJob }) {
  switch (job.status) {
    case "waiting":
      return <Badge variant="secondary">Waiting</Badge>;
    case "inspecting":
      return (
        <Badge className="bg-blue-500/15 text-blue-300 hover:bg-blue-500/15">
          <Loader2 className="h-3 w-3 animate-spin" /> Inspecting
        </Badge>
      );
    case "downloading":
      return (
        <Badge className="bg-blue-500/15 text-blue-300 hover:bg-blue-500/15">
          <Loader2 className="h-3 w-3 animate-spin" /> {Math.round(job.progress)}%
        </Badge>
      );
    case "completed":
      return <Badge className="bg-green-500/15 text-green-300 hover:bg-green-500/15">Done</Badge>;
    case "paused":
      return <Badge className="bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/15">Paused</Badge>;
    case "cancelled":
      return <Badge className="bg-zinc-500/15 text-zinc-300 hover:bg-zinc-500/15">Cancelled</Badge>;
    case "retrying":
      return (
        <Badge className="bg-orange-500/15 text-orange-300 hover:bg-orange-500/15">
          Retry {job.retryCount}
        </Badge>
      );
    case "failed":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="bg-red-500/15 text-red-300 hover:bg-red-500/15 cursor-help">
                Failed
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm break-words">{job.error || "Failed"}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
  }
}

export function QueueTable({
  jobs,
  onCancel,
  onPause,
  onResume,
  onClearFinished,
}: {
  jobs: DownloadJob[];
  onCancel: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onClearFinished: () => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 py-16 text-muted-foreground">
        <Download className="h-8 w-8" />
        <p className="text-sm">No downloads yet. Add URLs above to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClearFinished}>
          Clear Finished
        </Button>
      </div>
      <div className="rounded-xl border border-white/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[56px]"></TableHead>
              <TableHead className="w-[56px]">Platform</TableHead>
              <TableHead>Creator</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-[72px]">Quality</TableHead>
              <TableHead className="w-[180px]">Progress</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[84px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell>
                  {job.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={job.thumbnail} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-white/5">
                      <Download className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                </TableCell>
                <TableCell><PlatformBadge platform={job.platform} /></TableCell>
                <TableCell className="text-sm">
                  {job.creator || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="max-w-[280px] truncate text-sm" title={job.title || job.url}>
                  {(job.title || job.url).slice(0, 60)}
                  {job.status === "failed" && job.error && (
                    <p className="truncate text-[11px] text-red-300" title={job.error}>{job.error}</p>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{job.quality}</TableCell>
                <TableCell>
                  {job.status === "downloading" ? (
                    <div className="space-y-1">
                      <Progress value={job.progress} />
                      <p className="text-[10px] text-muted-foreground">
                        {job.speed && `${job.speed} · `}{job.eta && `ETA ${job.eta}`}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell><StatusBadge job={job} /></TableCell>
                <TableCell className="flex gap-1">
                  {job.status === "paused" ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onResume(job.id)} title="Resume">
                      <Play className="h-4 w-4" />
                    </Button>
                  ) : !["completed", "failed", "cancelled"].includes(job.status) ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onPause(job.id)} title="Pause">
                      <Pause className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {job.status !== "completed" && job.status !== "cancelled" && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onCancel(job.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
