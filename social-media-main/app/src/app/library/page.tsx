"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterBar, type LibraryFilters } from "@/components/library/filter-bar";
import { VideoGrid } from "@/components/library/video-grid";
import { VideoPreviewModal } from "@/components/library/video-preview-modal";
import type { VideoWithUrls } from "@/lib/services/video-library-service";

export default function LibraryPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<VideoWithUrls[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<LibraryFilters>({ platform: "", publish_status: "", search: "" });
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  const stats = useMemo(() => {
    let available = 0, scheduled = 0, published = 0;
    for (const v of videos) {
      if (v.publish_status === "unpublished") available++;
      else if (v.publish_status === "scheduled") scheduled++;
      else if (v.publish_status === "published") published++;
    }
    return { total: videos.length, available, scheduled, published };
  }, [videos]);

  const fetchVideos = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.platform) params.set("platform", filters.platform);
    if (filters.publish_status) params.set("publish_status", filters.publish_status);
    if (filters.search) params.set("search", filters.search);
    params.set("limit", "100");
    fetch(`/api/library?${params}`)
      .then((r) => r.json())
      .then(setVideos)
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(fetchVideos, [fetchVideos]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Video Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {stats.total} videos · {stats.available} available · {stats.scheduled} scheduled · {stats.published} published
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/downloader")}>
          <Download className="h-4 w-4 mr-2" />
          Download more
        </Button>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      <VideoGrid videos={videos} onVideoClick={(v) => setSelectedVideoId(v.id)} loading={loading} />

      <VideoPreviewModal
        videoId={selectedVideoId}
        onClose={() => setSelectedVideoId(null)}
        onDeleted={fetchVideos}
      />
    </div>
  );
}
