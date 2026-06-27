"use client";

import { Film } from "lucide-react";
import type { VideoWithUrls } from "@/lib/services/video-library-service";

function formatDuration(sec: number | null) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  youtube: { label: "YT", className: "bg-purple-600" },
  instagram: { label: "IG", className: "bg-pink-600" },
};

const STATUS_BADGE: Record<string, string> = {
  unpublished: "bg-zinc-600",
  scheduled: "bg-blue-600",
  published: "bg-green-600",
};

const STATUS_LABEL: Record<string, string> = {
  unpublished: "Available",
  scheduled: "Scheduled",
  published: "Published",
};

interface VideoCardProps {
  video: VideoWithUrls;
  onPreview: (video: VideoWithUrls) => void;
}

export function VideoCard({ video, onPreview }: VideoCardProps) {
  const platform = PLATFORM_BADGE[video.platform ?? ""] ?? null;
  const statusClass = STATUS_BADGE[video.publish_status] ?? "bg-zinc-600";
  const statusLabel = STATUS_LABEL[video.publish_status] ?? video.publish_status;

  return (
    <div
      className="group relative cursor-pointer rounded-lg overflow-hidden bg-zinc-900"
      style={{ aspectRatio: "9/16" }}
      onClick={() => onPreview(video)}
    >
      {video.thumbnail_url ? (
        <img
          src={video.thumbnail_url}
          alt={video.title}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zinc-800">
          <Film className="h-8 w-8 text-zinc-600" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <span className="text-sm font-medium text-white border border-white/40 rounded-lg px-3 py-1.5">
          Preview
        </span>
      </div>

      {/* Top badges */}
      <div className="absolute top-2 left-2 flex gap-1">
        {platform && (
          <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded ${platform.className}`}>
            {platform.label}
          </span>
        )}
      </div>
      {video.duration_sec && (
        <div className="absolute top-2 right-2">
          <span className="text-[10px] text-white bg-black/60 px-1.5 py-0.5 rounded">
            {formatDuration(video.duration_sec)}
          </span>
        </div>
      )}

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
        {video.creator && (
          <p className="text-[11px] text-zinc-300 truncate">{video.creator}</p>
        )}
        <p className="text-[12px] font-medium text-white truncate leading-tight">{video.title}</p>
        <span className={`mt-1 inline-block text-[10px] font-medium text-white px-1.5 py-0.5 rounded ${statusClass}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
