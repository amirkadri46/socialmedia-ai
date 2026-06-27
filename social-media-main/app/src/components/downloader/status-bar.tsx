"use client";

import { Separator } from "@/components/ui/separator";
import type { DownloadJob } from "@/lib/downloader/types";

const ACTIVE = new Set(["waiting", "inspecting", "downloading", "retrying"]);

export function StatusBar({ jobs }: { jobs: DownloadJob[] }) {
  const downloaded = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const remaining = jobs.filter((j) => ACTIVE.has(j.status)).length;

  // speed strings look like "1.2MiB/s" / "1.2 MB/s" — sum the leading number.
  const totalSpeed = jobs
    .filter((j) => j.status === "downloading")
    .reduce((sum, j) => sum + (parseFloat(j.speed) || 0), 0);

  const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );

  return (
    <div
      className="fixed bottom-0 right-0 z-10 flex items-center gap-3 border-t border-white/10 bg-background/95 px-6 py-2.5 text-xs backdrop-blur"
      style={{ left: 58 }}
    >
      <Stat label="Total" value={jobs.length} />
      <Separator orientation="vertical" className="h-4" />
      <Stat label="Downloaded" value={downloaded} />
      <Separator orientation="vertical" className="h-4" />
      <Stat label="Failed" value={failed} />
      <Separator orientation="vertical" className="h-4" />
      <Stat label="Remaining" value={remaining} />
      <Separator orientation="vertical" className="h-4" />
      <Stat label="Speed" value={totalSpeed > 0 ? `${totalSpeed.toFixed(1)} MB/s total` : "—"} />
    </div>
  );
}
