"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Film } from "lucide-react";
import type { VideoWithUrls } from "@/lib/services/video-library-service";

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function formatDuration(sec: number | null) {
  if (!sec) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function VideoSelector({ selectedIds, onChange }: Props) {
  const [videos, setVideos] = useState<VideoWithUrls[]>([]);
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    const p = new URLSearchParams();
    if (platform) p.set("platform", platform);
    if (search) p.set("search", search);
    p.set("limit", "200");
    fetch(`/api/library?${p}`).then((r) => r.json()).then(setVideos);
  }, [search, platform]);

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  };

  const selectAll = () => onChange(videos.map((v) => v.id));
  const clearAll = () => onChange([]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          placeholder="Search videos..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select value={platform || "_all"} onValueChange={(v) => setPlatform(v === "_all" ? "" : v)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
            <SelectItem value="instagram">Instagram</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="h-72 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {videos.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm">
            <Film className="h-6 w-6" />
            No videos found
          </div>
        )}
        {videos.map((v) => (
          <label
            key={v.id}
            className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/[0.03] transition-colors"
          >
            <Checkbox
              checked={selectedIds.includes(v.id)}
              onCheckedChange={() => toggle(v.id)}
            />
            {v.thumbnail_url ? (
              // Signed storage URLs are already size-bounded thumbnails; next/image remote config would add churn here.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.thumbnail_url} alt="" className="w-8 h-12 object-cover rounded shrink-0" />
            ) : (
              <div className="w-8 h-12 bg-zinc-800 rounded shrink-0 flex items-center justify-center">
                <Film className="h-3 w-3 text-zinc-600" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{v.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                {[v.creator, v.platform, formatDuration(v.duration_sec)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{selectedIds.length} selected</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={selectAll}>Select all</Button>
          {selectedIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
          )}
        </div>
      </div>
    </div>
  );
}
