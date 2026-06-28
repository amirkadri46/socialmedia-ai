"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Campaign } from "@/lib/db/types";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-zinc-700 text-zinc-300",
  ready: "bg-blue-900/50 text-blue-400",
  scheduled: "bg-blue-900/50 text-blue-400",
  running: "bg-green-900/50 text-green-400",
  paused: "bg-orange-900/50 text-orange-400",
  completed: "bg-green-900/50 text-green-400",
  failed: "bg-red-900/50 text-red-400",
  cancelled: "bg-red-900/50 text-red-400 line-through",
};

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampaigns = useCallback(() => {
    setLoading(true);
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then(setCampaigns)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { queueMicrotask(() => void fetchCampaigns()); }, [fetchCampaigns]);

  const pause = async (id: string) => {
    await fetch(`/api/campaigns/${id}/pause`, { method: "POST" });
    fetchCampaigns();
  };
  const resume = async (id: string) => {
    await fetch(`/api/campaigns/${id}/resume`, { method: "POST" });
    fetchCampaigns();
  };
  const deleteCampaign = async (id: string, name: string) => {
    if (!confirm(`Delete campaign "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    fetchCampaigns();
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <Button onClick={() => router.push("/campaigns/new")}>
          <Plus className="h-4 w-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <Megaphone className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">No campaigns yet.</p>
          <Button onClick={() => router.push("/campaigns/new")}>Create Campaign</Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="px-4 py-3">Name</TableHead>
                <TableHead className="px-4 py-3">Status</TableHead>
                <TableHead className="px-4 py-3">Created</TableHead>
                <TableHead className="px-4 py-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="px-4 py-3 font-medium">{c.name}</TableCell>
                  <TableCell className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[c.status] ?? "bg-zinc-700 text-zinc-300"}`}>
                      {c.status === "running" && (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                      )}
                      {c.status}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {c.status === "running" && (
                        <Button size="sm" variant="outline" onClick={() => pause(c.id)}>Pause</Button>
                      )}
                      {c.status === "paused" && (
                        <Button size="sm" variant="outline" onClick={() => resume(c.id)}>Resume</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => router.push(`/campaigns/${c.id}`)}>
                        Manage
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteCampaign(c.id, c.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
