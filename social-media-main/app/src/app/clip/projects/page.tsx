"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Film, Scissors, Loader2 } from "lucide-react";
import type { ClipJob } from "@/lib/types";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

export default function ProjectsPage() {
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/clip")
      .then((r) => r.json())
      .then((j: ClipJob[]) => setJobs(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">All your clipping jobs.</p>
        </div>
        <Button asChild>
          <Link href="/clip">
            <Scissors className="h-4 w-4" /> New Clip
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : jobs.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">No projects yet.</p>
          <Link href="/clip" className="mt-2 inline-block text-primary hover:underline">
            Create your first clip →
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/clip/${job.id}`}
              className="flex items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4 transition-colors hover:bg-accent"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{job.sourceTitle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {job.clipModel} · {job.captionPreset} · {job.aspectRatio} ·{" "}
                  {new Date(job.createdAt).toLocaleString()}
                </p>
              </div>
              <Badge variant={statusVariant(job.status)} className="capitalize shrink-0">
                {job.status}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
