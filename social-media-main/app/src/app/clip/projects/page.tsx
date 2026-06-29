"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Film, Scissors, Loader2, Trash2 } from "lucide-react";
import type { ClipJob } from "@/lib/types";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "error") return "destructive";
  return "secondary";
}

export default function ProjectsPage() {
  const [jobs, setJobs] = useState<ClipJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clip")
      .then((r) => r.json())
      .then((j: ClipJob[]) => setJobs(j))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function deleteProject(job: ClipJob) {
    if (!confirm(`Delete "${job.sourceTitle}"?`)) return;
    setDeletingId(job.id);
    try {
      const res = await fetch(`/api/clip/${job.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setJobs((current) => current.filter((j) => j.id !== job.id));
    } catch {
      alert("Could not delete project.");
    } finally {
      setDeletingId(null);
    }
  }

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
            <div
              key={job.id}
              className="flex items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4 transition-colors hover:bg-accent"
            >
              <Link href={`/clip/${job.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium">{job.sourceTitle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {job.clipModel} · {job.captionPreset} · {job.aspectRatio} ·{" "}
                  {new Date(job.createdAt).toLocaleString()}
                </p>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={statusVariant(job.status)} className="capitalize">
                  {job.status}
                </Badge>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deletingId === job.id}
                  onClick={() => deleteProject(job)}
                  title="Delete project"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
