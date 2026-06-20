"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Undo2, Redo2, Loader2, Download, Play, Pause,
  SkipBack, SkipForward, Captions as CaptionsIcon, Image as ImageIcon,
  Clapperboard, Blend, Music, Type, Sparkles, LayoutGrid, ZoomIn, ZoomOut, X, Crop,
} from "lucide-react";
import { useClipEdit } from "./use-clip-edit";
import { PreviewCanvas } from "./preview-canvas";
import { CropModal } from "./crop-modal";
import { TextOverlaySettings } from "./text-overlay-settings";
import { TranscriptPanel } from "./transcript-panel";
import { CaptionsPanel } from "./captions-panel";
import { MediaPanel, BrollPanel, TransitionsPanel, AudioPanel } from "./rail-panels";
import { Timeline } from "./timeline";
import {
  editedDuration, editedToSource, windowToEdited, nextKeptWindow, isRemoved,
} from "@/lib/clip/edit-timeline";
import type { ClipEdit } from "@/lib/types";

type PanelId = "captions" | "media" | "broll" | "transitions" | "text" | "audio" | null;

type RailItem = { id: string; icon: typeof Sparkles; label: string; disabled?: boolean };
const RAIL: RailItem[] = [
  { id: "enhance", icon: Sparkles, label: "AI enhance", disabled: true },
  { id: "captions", icon: CaptionsIcon, label: "Captions" },
  { id: "media", icon: ImageIcon, label: "Media" },
  { id: "brand", icon: LayoutGrid, label: "Brand template", disabled: true },
  { id: "broll", icon: Clapperboard, label: "B-Roll" },
  { id: "transitions", icon: Blend, label: "Transitions" },
  { id: "text", icon: Type, label: "Text" },
  { id: "audio", icon: Music, label: "Audio" },
];

export function EditorShell({ jobId, clipId }: { jobId: string; clipId: string }) {
  const ed = useClipEdit(jobId, clipId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState<PanelId>("captions");
  const [pxPerSec, setPxPerSec] = useState(40);
  const [cropOpen, setCropOpen] = useState(false);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ pct: number; log: string; done?: string } | null>(null);
  const raf = useRef<number | null>(null);

  const edit = ed.edit;
  const duration = edit ? editedDuration(edit) : 0;

  // Seek: paused reposition of both playhead and the underlying video.
  const seek = useCallback(
    (t: number) => {
      if (!edit) return;
      const clamped = Math.min(duration, Math.max(0, t));
      setPlayhead(clamped);
      if (videoRef.current) videoRef.current.currentTime = editedToSource(edit, clamped);
    },
    [edit, duration]
  );

  // Play loop: let the video play; map its time back to the edited timeline, skipping
  // removed gaps; pause at the edited end.
  useEffect(() => {
    if (!playing || !edit) return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
    const tick = () => {
      const windowT = v.currentTime - edit.sourceInSec;
      if (isRemoved(edit, windowT)) {
        const nxt = nextKeptWindow(edit, windowT);
        if (nxt == null) { setPlaying(false); return; }
        v.currentTime = edit.sourceInSec + nxt;
      }
      const ph = windowToEdited(edit, v.currentTime - edit.sourceInSec);
      setPlayhead(ph);
      if (ph >= duration - 0.05 || v.currentTime >= edit.sourceOutSec) {
        setPlaying(false);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      v.pause();
    };
  }, [playing, edit, duration]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowLeft") seek(playhead - 1);
      else if (e.key === "ArrowRight") seek(playhead + 1);
      else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); ed.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); ed.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playhead, seek, ed]);

  // Export via SSE.
  async function runExport() {
    setExporting({ pct: 0, log: "Starting export…" });
    try {
      const res = await fetch(`/api/clip/${jobId}/${clipId}/export`, { method: "POST" });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream");
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const d = JSON.parse(line.slice(6));
            setExporting({ pct: d.percent ?? 0, log: d.log ?? "", done: d.done });
          }
        }
      }
    } catch (e) {
      setExporting({ pct: 0, log: e instanceof Error ? e.message : "Export failed" });
    }
  }

  if (ed.loading) {
    return <div className="flex h-[70vh] items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (ed.error || !edit) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center space-y-3">
        <p className="text-muted-foreground">{ed.error || "Could not load this clip for editing."}</p>
        <Link href={`/clip/${jobId}`} className="text-primary hover:underline">← Back to results</Link>
      </div>
    );
  }

  const setLayoutMode = (mode: "fill" | "fit") =>
    ed.update((d) => { d.layout.forEach((s) => (s.mode = mode)); });
  const currentMode = edit.layout[0]?.mode ?? "fill";

  return (
    <div className="-mx-6 -my-8 flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <Button asChild variant="ghost" size="icon-sm">
          <Link href={`/clip/${jobId}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{ed.clip?.title || "Edit clip"}</p>
        <Button onClick={ed.undo} disabled={!ed.canUndo} variant="ghost" size="icon-sm"><Undo2 className="h-4 w-4" /></Button>
        <Button onClick={ed.redo} disabled={!ed.canRedo} variant="ghost" size="icon-sm"><Redo2 className="h-4 w-4" /></Button>
        <Button onClick={ed.saveNow} variant="outline">
          {ed.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save changes
        </Button>
        <Button onClick={runExport}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* Main 3-column area */}
      <div className="flex min-h-0 flex-1">
        {/* Left: transcript */}
        <div className="w-[360px] shrink-0 border-r p-4">
          <TranscriptPanel edit={edit} words={ed.words} onUpdate={ed.update} onSeek={(wt) => seek(windowToEdited(edit, wt))} />
        </div>

        {/* Center: status + preview */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-center gap-4 border-b py-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-1">{edit.aspectRatio}</span>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Layout:</span>
              {(["fill", "fit"] as const).map((m) => (
                <Button key={m} onClick={() => setLayoutMode(m)} variant={currentMode === m ? "secondary" : "ghost"} size="xs" className="capitalize">{m}</Button>
              ))}
            </div>
            <span
              title="Auto speaker-tracking is coming soon — use Crop to frame the speaker manually."
              className="flex cursor-not-allowed items-center gap-1 rounded-md px-2 py-1 text-muted-foreground opacity-50"
            >
              Tracker: soon
            </span>
            <Button
              onClick={() => setCropOpen(true)}
              variant="ghost"
              size="xs"
              title="Crop / reframe"
            >
              <Crop className="h-3.5 w-3.5" /> Crop
            </Button>
          </div>

          <div className="min-h-0 flex-1 p-4">
            <PreviewCanvas
              jobId={jobId}
              edit={edit}
              words={ed.words}
              playhead={playhead}
              videoRef={videoRef}
              onUpdate={ed.update}
              selectedTextId={selectedTextId}
              onSelectText={setSelectedTextId}
            />
          </div>
        </div>

        {/* Right rail + floating panel */}
        <div className="relative flex shrink-0 border-l">
          {panel && (
            <div className="absolute right-full top-0 z-20 mr-2 mt-2 max-h-[calc(100%-1rem)] overflow-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
              <div className="mb-2 flex justify-end">
                <Button onClick={() => setPanel(null)} variant="ghost" size="icon-sm"><X className="h-4 w-4" /></Button>
              </div>
              {panel === "captions" && <CaptionsPanel edit={edit} onUpdate={ed.update} />}
              {panel === "media" && <MediaPanel edit={edit} onUpdate={ed.update} playhead={playhead} />}
              {panel === "broll" && <BrollPanel edit={edit} onUpdate={ed.update} playhead={playhead} />}
              {panel === "transitions" && <TransitionsPanel edit={edit} onUpdate={ed.update} playhead={playhead} />}
              {panel === "audio" && <AudioPanel edit={edit} onUpdate={ed.update} playhead={playhead} />}
              {panel === "text" && <TextPanelInline edit={edit} onUpdate={ed.update} playhead={playhead} />}
            </div>
          )}
          <div className="flex w-[72px] flex-col items-center gap-1 py-3">
            {RAIL.map((r) => {
              const active = panel === r.id;
              return (
                <button
                  key={r.id}
                  disabled={r.disabled}
                  title={r.disabled ? `${r.label} (coming soon)` : r.label}
                  onClick={() => setPanel(active ? null : (r.id as PanelId))}
                  className={`flex w-16 flex-col items-center gap-1 rounded-lg py-2 text-[10px] transition-colors ${
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
                  } ${r.disabled ? "opacity-30" : ""}`}
                >
                  <r.icon className="h-4 w-4" />
                  {r.label.split(" ")[0]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom: transport + timeline */}
      <div className="border-t">
        <div className="flex items-center gap-3 px-4 py-2">
          <Button onClick={() => seek(0)} variant="ghost" size="icon-sm"><SkipBack className="h-4 w-4" /></Button>
          <Button onClick={() => setPlaying((p) => !p)} variant="secondary" size="icon" className="rounded-full">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button onClick={() => seek(duration)} variant="ghost" size="icon-sm"><SkipForward className="h-4 w-4" /></Button>
          <span className="font-mono text-xs text-muted-foreground">
            {fmt(playhead)} / {fmt(duration)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button onClick={() => setPxPerSec((p) => Math.max(10, p - 10))} variant="ghost" size="icon-sm"><ZoomOut className="h-4 w-4" /></Button>
            <Button onClick={() => setPxPerSec((p) => Math.min(120, p + 10))} variant="ghost" size="icon-sm"><ZoomIn className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="max-h-52 px-2 pb-2">
          <Timeline
            edit={edit}
            playhead={playhead}
            pxPerSec={pxPerSec}
            onSeek={seek}
            onZoom={(dir) => setPxPerSec((p) => Math.min(160, Math.max(8, p + dir * 12)))}
            onUpdate={ed.update}
          />
        </div>
      </div>

      {/* Text overlay settings popup (anchored to the right rail) */}
      {selectedTextId && edit.textOverlays.some((o) => o.id === selectedTextId) && (
        <div className="absolute right-[72px] top-24 z-40">
          <TextOverlaySettings
            overlay={edit.textOverlays.find((o) => o.id === selectedTextId)!}
            onUpdate={ed.update}
            onClose={() => setSelectedTextId(null)}
            onDelete={() => {
              ed.update((d) => { d.textOverlays = d.textOverlays.filter((o) => o.id !== selectedTextId); });
              setSelectedTextId(null);
            }}
          />
        </div>
      )}

      {/* Crop modal */}
      {cropOpen && (
        <CropModal
          jobId={jobId}
          clipId={clipId}
          sourceTime={editedToSource(edit, playhead)}
          aspect={edit.aspectRatio}
          crop={edit.layout[0]?.crop}
          onClose={() => setCropOpen(false)}
          onApply={(c) => {
            ed.update((d) => {
              if (d.layout[0]) { d.layout[0].crop = c; d.layout[0].mode = "fill"; }
            });
            setCropOpen(false);
          }}
        />
      )}

      {/* Export overlay */}
      {exporting && (
        <Dialog open onOpenChange={(o) => !o && setExporting(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{exporting.done ? "Export complete" : "Exporting…"}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{exporting.log}</p>
            <Progress value={exporting.pct} />
            {exporting.done && (
              <Button asChild className="w-full">
                <a href={exporting.done}><Download className="h-4 w-4" /> Download edited clip</a>
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// Small inline Text-overlay panel (add titles/hooks).
function TextPanelInline({ edit, onUpdate, playhead }: { edit: ClipEdit; onUpdate: (m: (d: ClipEdit) => ClipEdit | void) => void; playhead: number }) {
  return (
    <div className="w-[300px] space-y-3">
      <p className="text-sm font-semibold">Text</p>
      <Button
        onClick={() =>
          onUpdate((d) => {
            d.textOverlays.push({
              id: crypto.randomUUID(), text: "New text", start: playhead, end: Math.min(d.durationSec, playhead + 3),
              x: 0.5, y: 0.5, style: { bg: "#000000", color: "#FFFFFF", sizePx: 40, bold: true, radiusPx: 8 },
            });
          })
        }
        variant="outline" className="w-full"
      >
        <Type className="h-4 w-4" /> Add text
      </Button>
      <div className="space-y-2">
        {edit.textOverlays.map((o) => (
          <div key={o.id} className="rounded-md border bg-card p-2">
            <Input
              value={o.text}
              onChange={(e) => onUpdate((d) => { const t = d.textOverlays.find((x) => x.id === o.id); if (t) t.text = e.target.value; })}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
