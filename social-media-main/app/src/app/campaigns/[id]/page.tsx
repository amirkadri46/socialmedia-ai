"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Film, Users, Calendar, BarChart2, ListChecks } from "lucide-react";
import { ScheduleRuleEditor } from "@/components/campaigns/schedule-rule-editor";
import { CampaignPreviewCard } from "@/components/campaigns/campaign-preview-card";
import { AccountSelector } from "@/components/campaigns/account-selector";
import type { Campaign, CampaignVideo, InstagramAccount, ScheduleRule } from "@/lib/db/types";
import type { Video } from "@/lib/db/types";
import type { UploadJobWithMeta } from "@/lib/db/repositories/upload-job-repository";

const JOB_STATUS_STYLE: Record<string, string> = {
  queued: "bg-zinc-700 text-zinc-300",
  preparing: "bg-blue-900/50 text-blue-400",
  uploading: "bg-blue-900/50 text-blue-400",
  waiting_for_instagram: "bg-yellow-900/50 text-yellow-400",
  publishing: "bg-blue-900/50 text-blue-400",
  published: "bg-green-900/50 text-green-400",
  failed: "bg-red-900/50 text-red-400",
  cancelled: "bg-zinc-700 text-zinc-400",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-zinc-700 text-zinc-300",
  ready: "bg-blue-900/50 text-blue-400",
  scheduled: "bg-blue-900/50 text-blue-400",
  running: "bg-green-900/50 text-green-400",
  paused: "bg-orange-900/50 text-orange-400",
  completed: "bg-green-900/50 text-green-400",
  failed: "bg-red-900/50 text-red-400",
  cancelled: "bg-red-900/50 text-red-400",
};

interface CampaignVideoEnriched extends CampaignVideo {
  video: Video | null;
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [videos, setVideos] = useState<CampaignVideoEnriched[]>([]);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [addingIds, setAddingIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<UploadJobWithMeta[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    const [c, v, a, j] = await Promise.all([
      fetch(`/api/campaigns/${id}`).then((r) => r.json()),
      fetch(`/api/campaigns/${id}/videos`).then((r) => r.json()),
      fetch(`/api/campaigns/${id}/accounts`).then((r) => r.json()),
      fetch(`/api/upload-jobs?campaign_id=${id}&limit=100`).then((r) => r.json()),
    ]);
    setCampaign(c);
    setNameInput(c.name);
    setVideos(v);
    setAccounts(a);
    setJobs(j.jobs ?? []);
  }, [id]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // AccountSelector uses social-account IDs; the POST route bridges them to pub_instagram_accounts.
  const handleAddAccounts = async (newIds: string[]) => {
    const toAdd = newIds.filter((x) => !addingIds.includes(x));
    setAddingIds(newIds);
    if (toAdd.length > 0) {
      await Promise.all(toAdd.map((accountId) =>
        fetch(`/api/campaigns/${id}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        })
      ));
      await fetchAll();
    }
  };

  const removeAccount = async (pubAccountId: string) => {
    await fetch(`/api/campaigns/${id}/accounts`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: pubAccountId }),
    });
    await fetchAll();
  };

  const patchCampaign = async (data: Partial<Campaign>) => {
    setSaving(true);
    try {
      const updated = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }).then((r) => r.json());
      setCampaign(updated);
    } finally {
      setSaving(false);
    }
  };

  const action = async (endpoint: string) => {
    setSaving(true);
    try {
      await fetch(`/api/campaigns/${id}/${endpoint}`, { method: "POST" });
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    setEditingName(false);
    if (nameInput.trim() && nameInput !== campaign?.name) {
      await patchCampaign({ name: nameInput.trim() });
    }
  };

  const saveSchedule = (rule: ScheduleRule) => {
    setCampaign((current) => current ? { ...current, schedule_rule: rule, timezone: rule.timezone } : current);
    void patchCampaign({ schedule_rule: rule, timezone: rule.timezone });
  };

  const canEdit = campaign?.status === "draft" || campaign?.status === "paused";

  if (!campaign) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {editingName ? (
            <Input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="text-xl font-semibold h-auto py-1"
            />
          ) : (
            <h1
              className="text-2xl font-semibold cursor-pointer hover:underline"
              onClick={() => setEditingName(true)}
              title="Click to edit"
            >
              {campaign.name}
            </h1>
          )}
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[campaign.status] ?? "bg-zinc-700 text-zinc-300"}`}>
            {campaign.status}
          </span>
        </div>
        <div className="flex gap-2 shrink-0">
          {campaign.status === "running" && (
            <Button size="sm" variant="outline" onClick={() => action("pause")} disabled={saving}>
              Pause
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" onClick={() => action("resume")} disabled={saving}>
              Resume
            </Button>
          )}
          {(campaign.status === "draft" || campaign.status === "ready") && (
            <Button size="sm" onClick={() => action("publish")} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Publish
            </Button>
          )}
          {campaign.status !== "cancelled" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={async () => {
                if (!confirm(`Delete campaign "${campaign.name}"? This cannot be undone.`)) return;
                await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
                router.push("/campaigns");
              }}
              disabled={saving}
            >
              Delete Campaign
            </Button>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg border border-border p-4 flex items-center gap-3">
          <Film className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-muted-foreground">Videos</p>
            <p className="text-xl font-semibold">{videos.length}</p>
          </div>
        </div>
        <div className="rounded-lg border border-border p-4 flex items-center gap-3">
          <Users className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-muted-foreground">Accounts</p>
            <p className="text-xl font-semibold">{accounts.length}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="videos">
        <TabsList>
          <TabsTrigger value="videos"><Film className="h-4 w-4 mr-1.5" />Videos</TabsTrigger>
          <TabsTrigger value="accounts"><Users className="h-4 w-4 mr-1.5" />Accounts</TabsTrigger>
          <TabsTrigger value="schedule"><Calendar className="h-4 w-4 mr-1.5" />Schedule</TabsTrigger>
          <TabsTrigger value="preview"><BarChart2 className="h-4 w-4 mr-1.5" />Preview</TabsTrigger>
          <TabsTrigger value="jobs"><ListChecks className="h-4 w-4 mr-1.5" />Jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="mt-4">
          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No videos in this campaign.</p>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border">
              {videos.map((cv) => (
                <div key={cv.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground w-6 text-right">{cv.position + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{cv.video?.title ?? cv.video_id}</p>
                    <p className="text-xs text-muted-foreground">{cv.video?.creator}</p>
                  </div>
                  {cv.skipped && (
                    <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">Skipped</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="accounts" className="mt-4 flex flex-col gap-4">
          {accounts.length > 0 && (
            <div className="rounded-lg border border-border divide-y divide-border">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                  <p className="text-sm font-medium flex-1">@{a.username}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    a.status === "connected" ? "bg-green-900/40 text-green-400" : "bg-orange-900/40 text-orange-400"
                  }`}>
                    {a.status}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => removeAccount(a.id)}
                      className="text-xs text-destructive hover:underline ml-2"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canEdit && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Add accounts</p>
              <AccountSelector selectedIds={addingIds} onChange={handleAddAccounts} />
            </div>
          )}
          {!canEdit && accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">No accounts in this campaign.</p>
          )}
        </TabsContent>

        <TabsContent value="schedule" className="mt-4">
          <ScheduleRuleEditor
            value={campaign.schedule_rule}
            onChange={saveSchedule}
            disabled={!canEdit}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          <CampaignPreviewCard
            campaignId={id}
            videoCount={videos.filter((v) => !v.skipped).length}
            accountCount={accounts.length}
            scheduleRule={campaign.schedule_rule}
          />
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 flex flex-col gap-4">
          {/* Job counts */}
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span>{jobs.filter((j) => j.status === "queued").length} queued</span>
            <span>·</span>
            <span className="text-green-400">{jobs.filter((j) => j.status === "published").length} published</span>
            <span>·</span>
            <span className="text-red-400">{jobs.filter((j) => j.status === "failed").length} failed</span>
          </div>

          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs for this campaign yet.</p>
          ) : (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs uppercase tracking-wide">
                    <TableHead className="px-4 py-2.5">Video</TableHead>
                    <TableHead className="px-4 py-2.5">Account</TableHead>
                    <TableHead className="px-4 py-2.5">Scheduled</TableHead>
                    <TableHead className="px-4 py-2.5">Status</TableHead>
                    <TableHead className="px-4 py-2.5">Retries</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="px-4 py-2.5 max-w-[180px] truncate" title={job.video_title}>
                        {job.video_title || job.video_id}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-muted-foreground">@{job.account_username}</TableCell>
                      <TableCell className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {new Date(job.scheduled_at).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${JOB_STATUS_STYLE[job.status] ?? "bg-zinc-700 text-zinc-300"}`}>
                          {job.status}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-muted-foreground">
                        {job.retry_count > 0 ? job.retry_count : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/campaigns/queue?campaign_id=${id}`}>View all jobs in Queue →</Link>
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
