"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const PAGE_SIZE = 50;

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-zinc-700 text-zinc-300",
  preparing: "bg-blue-900/50 text-blue-400",
  uploading: "bg-blue-900/50 text-blue-400",
  waiting_for_instagram: "bg-yellow-900/50 text-yellow-400",
  publishing: "bg-blue-900/50 text-blue-400",
  published: "bg-green-900/50 text-green-400",
  failed: "bg-red-900/50 text-red-400",
  cancelled: "bg-zinc-700 text-zinc-400",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  preparing: "Preparing",
  uploading: "Uploading",
  waiting_for_instagram: "Waiting",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

const ALL_STATUSES = ["queued", "preparing", "uploading", "waiting_for_instagram", "publishing", "published", "failed"];

function formatScheduled(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function QueuePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [jobs, setJobs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(0);

  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [campaignId, setCampaignId] = useState(searchParams.get("campaign_id") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fetchJobs = async () => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (campaignId) p.set("campaign_id", campaignId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(page * PAGE_SIZE));
    const res = await fetch(`/api/upload-jobs?${p}`);
    const data = await res.json();
    setJobs(data.jobs ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    fetch("/api/campaigns").then((r) => r.json()).then(setCampaigns);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [status, campaignId, from, to, page]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const id = setInterval(fetchJobs, 15000);
    return () => clearInterval(id);
  }, [status, campaignId, from, to, page]);

  const counts = {
    queued: jobs.filter((j) => j.status === "queued").length,
    inProgress: jobs.filter((j) => ["preparing", "uploading", "waiting_for_instagram", "publishing"].includes(j.status)).length,
    published: jobs.filter((j) => j.status === "published").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Upload Queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} total jobs</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0); }}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          value={campaignId}
          onChange={(e) => { setCampaignId(e.target.value); setPage(0); }}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          type="date"
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(0); }}
          placeholder="From"
        />
        <input
          type="date"
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(0); }}
          placeholder="To"
        />
        {(status || campaignId || from || to) && (
          <Button size="sm" variant="ghost" onClick={() => { setStatus(""); setCampaignId(""); setFrom(""); setTo(""); setPage(0); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Queued", value: counts.queued, color: "text-zinc-300" },
          { label: "In Progress", value: counts.inProgress, color: "text-blue-400" },
          { label: "Published", value: counts.published, color: "text-green-400" },
          { label: "Failed", value: counts.failed, color: "text-red-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-muted-foreground">
          <p>No jobs in queue.</p>
          <Button asChild variant="outline" size="sm">
            <Link href="/campaigns">Go to Campaigns</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Campaign</th>
                  <th className="text-left px-4 py-2.5">Video</th>
                  <th className="text-left px-4 py-2.5">Account</th>
                  <th className="text-left px-4 py-2.5">Scheduled</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Retries</th>
                  <th className="text-left px-4 py-2.5">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 text-muted-foreground">{job.campaign_name || "—"}</td>
                    <td className="px-4 py-2.5 max-w-[180px] truncate" title={job.video_title}>
                      {job.video_title.slice(0, 30)}{job.video_title.length > 30 ? "…" : ""}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">@{job.account_username}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatScheduled(job.scheduled_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[job.status] ?? "bg-zinc-700 text-zinc-300"}`}>
                        {job.status === "waiting_for_instagram" && (
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                        )}
                        {STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {job.retry_count > 0 ? job.retry_count : "—"}
                    </td>
                    <td className="px-4 py-2.5 max-w-[200px]">
                      {job.error_message ? (
                        <span className="text-red-400 text-xs truncate block" title={job.error_message}>
                          {job.error_message.slice(0, 50)}{job.error_message.length > 50 ? "…" : ""}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
