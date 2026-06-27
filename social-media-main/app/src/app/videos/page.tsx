"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Heart, MessageCircle, Film, Sparkles, Search, Star, Play,
  ArrowUpDown, X, ExternalLink, GripVertical, RotateCcw,
} from "lucide-react";
import { MarkdownContent } from "@/components/markdown-content";
import type { Video, Config } from "@/lib/types";

function formatViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

type SortOption = "views" | "date-posted" | "date-added" | "starred";

export default function VideosPage() {
  return (
    <Suspense>
      <VideosContent />
    </Suspense>
  );
}

function VideosContent() {
  const searchParams = useSearchParams();
  const [videos, setVideos] = useState<Video[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [filterConfig, setFilterConfig] = useState<string>("all");
  const [filterCreator, setFilterCreator] = useState<string>(searchParams.get("creator") || "all");
  const [sortBy, setSortBy] = useState<SortOption>("views");
  const [modalVideo, setModalVideo] = useState<Video | null>(null);
  const [modalSection, setModalSection] = useState<"analysis" | "concepts">("analysis");

  // Drag-to-reorder state
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Resizable modal state
  const [modalWidth, setModalWidth] = useState(() => {
    if (typeof window === "undefined") return 800;
    return parseInt(localStorage.getItem("video-modal-width") || "800", 10);
  });
  const isResizingRef = useRef(false);
  const resizeDirRef = useRef<"left" | "right">("right");
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    fetch("/api/videos").then((r) => r.json()).then(setVideos);
    fetch("/api/configs").then((r) => r.json()).then(setConfigs);
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const sign = resizeDirRef.current === "right" ? 1 : -1;
      const newWidth = Math.max(560, Math.min(window.innerWidth - 60, startWidthRef.current + sign * delta));
      setModalWidth(newWidth);
      localStorage.setItem("video-modal-width", String(Math.round(newWidth)));
    };
    const onMouseUp = () => { isResizingRef.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startModalResize = (e: React.MouseEvent, dir: "left" | "right") => {
    isResizingRef.current = true;
    resizeDirRef.current = dir;
    startXRef.current = e.clientX;
    startWidthRef.current = modalWidth;
    e.preventDefault();
    e.stopPropagation();
  };

  // Reset custom order when filters or sort change
  useEffect(() => {
    setCustomOrder(null);
  }, [filterConfig, filterCreator, sortBy]);

  // Reset creator filter when config changes so a cross-config creator can't stay selected
  useEffect(() => {
    setFilterCreator("all");
  }, [filterConfig]);

  const uniqueCreators = useMemo(() => [
    ...new Set(
      videos
        .filter((v) => filterConfig === "all" || v.configName === filterConfig)
        .map((v) => v.creator)
    ),
  ].sort(), [videos, filterConfig]);

  const filtered = useMemo(() => videos
    .filter((v) => {
      if (filterConfig !== "all" && v.configName !== filterConfig) return false;
      if (filterCreator !== "all" && v.creator !== filterCreator) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "starred") {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return b.views - a.views;
      }
      if (sortBy === "views") return b.views - a.views;
      if (sortBy === "date-posted") return (b.datePosted || "").localeCompare(a.datePosted || "");
      if (sortBy === "date-added") return (b.dateAdded || "").localeCompare(a.dateAdded || "");
      return 0;
    }), [videos, filterConfig, filterCreator, sortBy]);

  // Apply custom order on top of filtered/sorted list
  const display = useMemo(() => {
    if (!customOrder) return filtered;
    const idMap = new Map<string, Video>(filtered.map((v) => [v.id || v.link, v]));
    const ordered: Video[] = [];
    for (const id of customOrder) {
      const v = idMap.get(id);
      if (v) ordered.push(v);
    }
    const orderedSet = new Set(customOrder);
    for (const v of filtered) {
      if (!orderedSet.has(v.id || v.link)) ordered.push(v);
    }
    return ordered;
  }, [filtered, customOrder]);

  const openModal = (video: Video, section: "analysis" | "concepts") => {
    setModalVideo(video);
    setModalSection(section);
  };

  const toggleStar = async (id: string, currentStarred: boolean) => {
    const newStarred = !currentStarred;
    setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, starred: newStarred } : v)));
    await fetch("/api/videos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, starred: newStarred }),
    });
  };

  const removeVideo = async (id: string) => {
    if (!confirm("Remove this video permanently?")) return;
    setVideos((prev) => prev.filter((v) => v.id !== id));
    setCustomOrder((prev) => prev ? prev.filter((oid) => oid !== id) : null);
    await fetch(`/api/videos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragOverId) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const fromId = draggedId;
    setDraggedId(null);
    setDragOverId(null);
    if (!fromId || fromId === targetId) return;

    const currentOrder = display.map((v) => v.id || v.link);
    const fromIdx = currentOrder.indexOf(fromId);
    const toIdx = currentOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const newOrder = [...currentOrder];
    const [removed] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, removed);
    setCustomOrder(newOrder);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Videos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse analyzed competitor reels with AI insights
        </p>
      </div>

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterConfig} onValueChange={setFilterConfig}>
          <SelectTrigger className="w-[220px] rounded-xl glass border-white/[0.08] h-10">
            <SelectValue placeholder="Filter by config" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Configs</SelectItem>
            {configs.map((c) => (
              <SelectItem key={c.id} value={c.configName}>{c.configName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterCreator} onValueChange={setFilterCreator}>
          <SelectTrigger className="w-[200px] rounded-xl glass border-white/[0.08] h-10">
            <SelectValue placeholder="Filter by creator" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Creators</SelectItem>
            {uniqueCreators.map((c) => (
              <SelectItem key={c} value={c}>@{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
          <SelectTrigger className="w-[180px] rounded-xl glass border-white/[0.08] h-10">
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="views">Most Views</SelectItem>
            <SelectItem value="date-posted">Date Posted</SelectItem>
            <SelectItem value="date-added">Date Added</SelectItem>
            <SelectItem value="starred">Starred First</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="secondary" className="rounded-lg px-3 py-1.5 text-xs bg-white/[0.05] border border-white/[0.08]">
          {display.length} videos
        </Badge>

        {customOrder && (
          <button
            onClick={() => setCustomOrder(null)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset order
          </button>
        )}
      </div>

      {/* Drag hint */}
      {display.length > 0 && (
        <p className="text-[11px] text-muted-foreground/50 -mt-4">
          Drag cards to reorder · hover a card for remove button
        </p>
      )}

      {/* Video Grid — Instagram-style */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {display.map((video) => {
          const id = video.id || video.link;
          const isDragging = draggedId === id;
          const isDragOver = dragOverId === id && draggedId !== id;

          return (
            <div
              key={id}
              className={`group relative transition-all duration-150 ${isDragging ? "opacity-40 scale-95" : ""} ${isDragOver ? "ring-2 ring-purple-500/60 rounded-2xl" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, id)}
              onDrop={(e) => handleDrop(e, id)}
            >
              {/* Drag handle — top-left, visible on hover */}
              <div
                className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing h-6 w-6 rounded-md bg-black/60 border border-white/10 flex items-center justify-center"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <GripVertical className="h-3.5 w-3.5 text-white/70" />
              </div>

              {/* Remove button — top-right, visible on hover */}
              <button
                className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/20"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeVideo(id); }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <X className="h-3 w-3" />
              </button>

              <div className="glass rounded-2xl overflow-hidden transition-all duration-300 hover:border-white/[0.12]">
                {/* Thumbnail — clickable, 9:16 ratio */}
                <a
                  href={video.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative block aspect-[9/16] w-full bg-white/[0.02] overflow-hidden"
                >
                  {video.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/proxy-image?url=${encodeURIComponent(video.thumbnail)}`}
                      alt={`@${video.creator}`}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Film className="h-10 w-10 text-muted-foreground/20" />
                    </div>
                  )}
                  {/* Views overlay — Instagram style */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent pt-8 pb-2.5 px-3">
                    <div className="flex items-center gap-1.5">
                      <Play className="h-4 w-4 text-white fill-white" />
                      <span className="text-[15px] font-bold text-white">
                        {formatViews(video.views)}
                      </span>
                    </div>
                  </div>
                </a>

                {/* Info bar */}
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold truncate">@{video.creator}</p>
                    <button
                      onClick={() => toggleStar(id, video.starred)}
                      className="shrink-0 ml-1.5 transition-colors"
                    >
                      <Star
                        className={`h-4 w-4 ${video.starred ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40 hover:text-yellow-400/60"}`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Heart className="h-3 w-3" />
                      {formatViews(video.likes)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {formatViews(video.comments)}
                    </span>
                    <span className="ml-auto text-[10px]">{video.datePosted}</span>
                  </div>

                  <Badge variant="secondary" className="rounded-md text-[10px] bg-white/[0.05] border border-white/[0.06] text-muted-foreground">
                    {video.configName}
                  </Badge>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openModal(video, "analysis")}
                      className="flex-1 rounded-xl text-[11px] h-7 gap-1 transition-all duration-200 glass border-white/[0.06] text-muted-foreground hover:text-foreground"
                    >
                      <Search className="h-3 w-3" />
                      Analysis
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openModal(video, "concepts")}
                      className="flex-1 rounded-xl text-[11px] h-7 gap-1 transition-all duration-200 glass border-white/[0.06] text-muted-foreground hover:text-foreground"
                    >
                      <Sparkles className="h-3 w-3" />
                      Concepts
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {display.length === 0 && (
        <div className="glass rounded-2xl p-12 text-center">
          <Film className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <h3 className="mt-4 font-semibold">No videos found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a pipeline analysis to generate results, or adjust your filters.
          </p>
        </div>
      )}

      {/* Analysis / Concepts Modal */}
      <Dialog open={!!modalVideo} onOpenChange={(open) => { if (!open) setModalVideo(null); }}>
        <DialogContent
          className="max-h-[90vh] overflow-hidden glass-strong rounded-2xl border-white/[0.08] p-0 gap-0"
          style={{ width: modalWidth, maxWidth: "95vw" }}
        >
          {/* Left resize handle */}
          <div
            className="absolute left-0 top-0 h-full w-2 cursor-ew-resize z-50 group/handle"
            onMouseDown={(e) => startModalResize(e, "left")}
          >
            <div className="h-full w-full opacity-0 group-hover/handle:opacity-100 bg-purple-500/20 transition-opacity" />
          </div>
          {/* Right resize handle */}
          <div
            className="absolute right-0 top-0 h-full w-2 cursor-ew-resize z-50 group/handle"
            onMouseDown={(e) => startModalResize(e, "right")}
          >
            <div className="h-full w-full opacity-0 group-hover/handle:opacity-100 bg-purple-500/20 transition-opacity" />
          </div>

          <DialogTitle className="sr-only">
            {modalSection === "analysis" ? "Video Analysis" : "New Concepts"}
          </DialogTitle>
          {modalVideo && (
            <>
              {/* Modal header */}
              <div className="flex items-center gap-4 p-5 border-b border-white/[0.06]">
                {/* Mini thumbnail */}
                <div className="relative h-16 w-12 shrink-0 rounded-lg overflow-hidden bg-white/[0.02]">
                  {modalVideo.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/proxy-image?url=${encodeURIComponent(modalVideo.thumbnail)}`}
                      alt={`@${modalVideo.creator}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Film className="h-4 w-4 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">@{modalVideo.creator}</p>
                    <a
                      href={modalVideo.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-purple-400 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <span className="text-[10px] text-muted-foreground/40 ml-1">← drag edges to resize →</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Play className="h-3 w-3 fill-current" />
                      {formatViews(modalVideo.views)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Heart className="h-3 w-3" />
                      {formatViews(modalVideo.likes)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {formatViews(modalVideo.comments)}
                    </span>
                  </div>
                </div>
                {/* Section toggle */}
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModalSection("analysis")}
                    className={`rounded-xl text-xs h-8 gap-1.5 transition-all duration-200 ${
                      modalSection === "analysis"
                        ? "bg-purple-500/15 text-purple-300 border border-purple-500/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Search className="h-3 w-3" />
                    Analysis
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setModalSection("concepts")}
                    className={`rounded-xl text-xs h-8 gap-1.5 transition-all duration-200 ${
                      modalSection === "concepts"
                        ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Sparkles className="h-3 w-3" />
                    Concepts
                  </Button>
                </div>
              </div>

              {/* Modal body — scrollable */}
              <div className="overflow-y-auto max-h-[calc(90vh-100px)] p-6">
                <MarkdownContent
                  content={modalSection === "analysis" ? modalVideo.analysis : modalVideo.newConcepts}
                  variant={modalSection === "analysis" ? "analysis" : "concepts"}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
