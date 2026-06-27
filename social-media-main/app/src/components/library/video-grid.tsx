"use client";

import { useRouter } from "next/navigation";
import { Film } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { VideoCard } from "./video-card";
import type { VideoWithUrls } from "@/lib/services/video-library-service";

interface VideoGridProps {
  videos: VideoWithUrls[];
  onVideoClick: (video: VideoWithUrls) => void;
  loading: boolean;
}

export function VideoGrid({ videos, onVideoClick, loading }: VideoGridProps) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="rounded-lg" style={{ aspectRatio: "9/16" }} />
        ))}
      </div>
    );
  }

  if (!videos.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <Film className="h-12 w-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">No videos yet. Go to Downloads to get started.</p>
        <Button variant="outline" onClick={() => router.push("/downloader")}>
          Go to Downloader
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 gap-2">
      {videos.map((v) => (
        <VideoCard key={v.id} video={v} onPreview={onVideoClick} />
      ))}
    </div>
  );
}
