"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";
import type { VideoDetail } from "@/lib/services/video-library-service";

interface VideoPreviewModalProps {
  videoId: string | null;
  onClose: () => void;
  onDeleted?: () => void;
}

export function VideoPreviewModal({ videoId, onClose, onDeleted }: VideoPreviewModalProps) {
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [detailError, setDetailError] = useState<string>("");
  const [caption, setCaption] = useState<string>("");
  const [captionLoading, setCaptionLoading] = useState(false);
  const [captionError, setCaptionError] = useState<string>("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!videoId) { setDetail(null); setDetailError(""); setCaption(""); setCaptionError(""); return; }
    setDetailError("");
    fetch(`/api/library/${videoId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) { setDetailError(d.error ?? "Failed to load video"); return; }
        setDetail(d);
        setCaption(d.captions?.[0]?.caption ?? "");
      })
      .catch(() => setDetailError("Network error"));
  }, [videoId]);

  const generateCaption = async () => {
    if (!videoId) return;
    setCaptionLoading(true);
    setCaptionError("");
    try {
      const res = await fetch(`/api/library/${videoId}/caption`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) { setCaptionError(data.error ?? "Caption generation failed"); return; }
      setCaption(data.caption ?? "");
    } catch {
      setCaptionError("Network error — check console");
    } finally {
      setCaptionLoading(false);
    }
  };

  const deleteVideo = async () => {
    if (!videoId) return;
    setDeleteLoading(true);
    try {
      await fetch(`/api/library/${videoId}`, { method: "DELETE" });
      onDeleted?.();
      onClose();
    } finally {
      setDeleteLoading(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open={!!videoId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        {detail ? (
          <div className="flex flex-col sm:flex-row">
            {/* Left — video */}
            <div className="sm:w-[60%] bg-black flex flex-col">
              {detail.video_url ? (
                <video controls src={detail.video_url} className="w-full" style={{ maxHeight: 480 }} />
              ) : (
                <div className="w-full flex items-center justify-center bg-zinc-900 text-zinc-500 text-sm" style={{ minHeight: 200 }}>
                  Video file not available
                </div>
              )}
              <div className="p-4 space-y-1">
                <DialogHeader>
                  <DialogTitle className="text-base leading-snug">{detail.title}</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  {[detail.creator, detail.platform, detail.duration_sec ? `${Math.round(detail.duration_sec)}s` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {detail.downloaded_at && (
                  <p className="text-xs text-muted-foreground">
                    Downloaded {new Date(detail.downloaded_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>

            {/* Right — caption + actions */}
            <div className="sm:w-[40%] flex flex-col gap-4 p-4 border-l border-border">
              <p className="text-sm font-semibold">Caption</p>
              {captionError && <p className="text-xs text-destructive">{captionError}</p>}
              {caption ? (
                <>
                  <Textarea
                    readOnly
                    value={caption}
                    className="flex-1 resize-none text-sm min-h-[140px]"
                  />
                  <Button size="sm" variant="outline" onClick={generateCaption} disabled={captionLoading}>
                    {captionLoading && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                    Regenerate
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No caption generated yet.</p>
                  <Button size="sm" onClick={generateCaption} disabled={captionLoading}>
                    {captionLoading && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                    Generate Caption
                  </Button>
                </>
              )}

              <Separator />

              {confirmDelete ? (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">Delete this video from the library? This cannot be undone.</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={deleteVideo} disabled={deleteLoading}>
                      {deleteLoading && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                      Confirm Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  Delete from Library
                </Button>
              )}
            </div>
          </div>
        ) : detailError ? (
          <div className="flex items-center justify-center h-48">
            <p className="text-sm text-destructive">{detailError}</p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
