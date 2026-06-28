"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlInputPanel } from "@/components/downloader/url-input-panel";
import { ProfileInputPanel } from "@/components/downloader/profile-input-panel";
import { QueueTable } from "@/components/downloader/queue-table";
import { StatusBar } from "@/components/downloader/status-bar";
import type { DownloadJob } from "@/lib/downloader/types";

export default function DownloaderPage() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [activeTab, setActiveTab] = useState("urls");
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const ACTIVE_STATUSES = new Set(["waiting", "inspecting", "downloading", "uploading", "retrying"]);
    const poll = () => {
      if (document.hidden) { timer = setTimeout(poll, 10_000); return; }
      fetch("/api/downloader/queue")
        .then((r) => r.json())
        .then((data: DownloadJob[]) => {
          setJobs(data);
          const hasActive = data.some((j) => ACTIVE_STATUSES.has(j.status));
          timer = setTimeout(poll, hasActive ? 2_000 : 10_000);
        })
        .catch(() => { timer = setTimeout(poll, 5_000); });
    };
    poll();
    return () => clearTimeout(timer);
  }, []);

  const addUrls = async (urls: string[]) => {
    if (urls.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/downloader/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not add URLs");
      setJobs(await fetch("/api/downloader/queue").then((r) => r.json()));
      toast.success(body.added > 0 ? `Added ${body.added} to queue` : "No new URLs added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add URLs");
    } finally {
      setLoading(false);
    }
  };

  const scrapeAndAdd = async (profileUrl: string, limit?: number) => {
    setScraping(true);
    try {
      const res = await fetch("/api/downloader/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: profileUrl, limit }),
      });
      const { urls, error } = await res.json();
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(`Found ${urls.length} videos, adding to queue`);
      await fetch("/api/downloader/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setScraping(false);
    }
  };

  const cancel = (id: string) =>
    fetch("/api/downloader/queue", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: id }),
    }).then(() => fetch("/api/downloader/queue"))
      .then((r) => r.json())
      .then(setJobs);

  const clearFinished = () =>
    fetch("/api/downloader/queue", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(() => fetch("/api/downloader/queue"))
      .then((r) => r.json())
      .then(setJobs);

  return (
    <div className="flex flex-col gap-6 pb-16">
      <div>
        <h1 className="text-2xl font-semibold">Downloader</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download YouTube Shorts and Instagram Reels in bulk
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="urls">Bulk URLs</TabsTrigger>
              <TabsTrigger value="profile">Creator Profile</TabsTrigger>
            </TabsList>
            <TabsContent value="urls">
              <UrlInputPanel onSubmit={addUrls} loading={loading} />
            </TabsContent>
            <TabsContent value="profile">
              <ProfileInputPanel onSubmit={scrapeAndAdd} loading={scraping} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <QueueTable jobs={jobs} onCancel={cancel} onClearFinished={clearFinished} />

      <StatusBar jobs={jobs} />
    </div>
  );
}
