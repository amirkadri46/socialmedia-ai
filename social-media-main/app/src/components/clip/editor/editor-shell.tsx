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
  Scissors, Trash2, Volume2, VolumeX, Wand2, Aperture,
} from "lucide-react";
import { useClipEdit } from "./use-clip-edit";
import { PreviewCanvas } from "./preview-canvas";
import { CropModal } from "./crop-modal";
import { TextOverlaySettings } from "./text-overlay-settings";
import { TranscriptPanel } from "./transcript-panel";
import { CaptionsPanel } from "./captions-panel";
import { MediaPanel, BrollPanel, TransitionsPanel, AudioPanel, LayerPresetsPanel, BackgroundPanel } from "./rail-panels";
import { Timeline, type Selection, type TimelineItem } from "./timeline";
import {
  editedDuration, editedToSource, editedToWindow, windowToEdited, nextKeptWindow, isRemoved, mergeRanges, layoutAt,
} from "@/lib/clip/edit-timeline";
import {
  DEFAULT_SHORTCUTS, resolveShortcuts, eventToCombo, formatCombo,
  type EditorShortcuts, type ShortcutAction,
} from "@/lib/clip/shortcuts";
import { splitSlots } from "@/lib/clip/layout-geom";
import type { ClipEdit, LayoutKind } from "@/lib/types";

type PanelId = "captions" | "media" | "presets" | "background" | "broll" | "transitions" | "text" | "audio" | null;

type RailItem = { id: string; icon: typeof Sparkles; label: string; disabled?: boolean };
const RAIL: RailItem[] = [
  { id: "enhance", icon: Sparkles, label: "AI enhance", disabled: true },
  { id: "captions", icon: CaptionsIcon, label: "Captions" },
  { id: "media", icon: ImageIcon, label: "Media" },
  { id: "presets", icon: LayoutGrid, label: "Presets" },
  { id: "background", icon: Aperture, label: "Background" },
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
  const [leftWidth, setLeftWidth] = useState(360);
  const [cropOpen, setCropOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TimelineItem | null>(null);
  const selectedTextId = selectedItem?.kind === "text" ? selectedItem.id : null;
  const [exporting, setExporting] = useState<{ pct: number; log: string; done?: string } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fps, setFps] = useState(30);
  const [shortcuts, setShortcuts] = useState<EditorShortcuts>(DEFAULT_SHORTCUTS);
  const [autoframing, setAutoframing] = useState(false);
  const [autoframeError, setAutoframeError] = useState<string | null>(null);
  const [toolMsg, setToolMsg] = useState<string | null>(null);
  const raf = useRef<number | null>(null);

  const edit = ed.edit;
  const duration = edit ? editedDuration(edit) : 0;
  const frameStep = fps > 0 ? 1 / fps : 1 / 30;

  // Load configurable keyboard shortcuts from Settings.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => setShortcuts(resolveShortcuts(s.editorShortcuts)))
      .catch(() => {});
  }, []);

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

  // Step exactly one source frame forward/backward.
  const stepFrame = useCallback((dir: 1 | -1) => seek(playhead + dir * frameStep), [seek, playhead, frameStep]);

  // ── Timeline toolbar actions (also bound to shortcuts) ──────────────────────────
  const splitAtPlayhead = useCallback(() => {
    if (!edit) return;
    // Check before updating so we can give feedback without an empty undo entry.
    const canSplit = edit.layout.some(
      (s) => playhead > s.start + 1e-3 && playhead < s.end - 1e-3
    );
    if (!canSplit) {
      setToolMsg("Playhead is at an existing cut");
      setTimeout(() => setToolMsg(null), 2000);
      return;
    }
    ed.update((d) => {
      const i = d.layout.findIndex((s) => playhead > s.start + 1e-3 && playhead < s.end - 1e-3);
      if (i < 0) return;
      const seg = d.layout[i];
      const right = {
        ...seg,
        id: crypto.randomUUID(),
        start: playhead,
        crop: seg.crop ? { ...seg.crop } : undefined,
        frame: seg.frame ? { ...seg.frame } : undefined,
        // Deep-copy panes so each half's speaker crops are independent.
        panes: seg.panes ? seg.panes.map((p) => ({ ...p, crop: { ...p.crop } })) : undefined,
      };
      seg.end = playhead;
      d.layout.splice(i + 1, 0, right);
    });
  }, [edit, ed, playhead]);

  // Delete: a selected timeline item (text / media / B-roll / audio) takes priority;
  // otherwise fall back to removing the marquee time-range selection.
  const deleteSelected = useCallback(() => {
    if (!edit) return;
    if (selectedItem) {
      const { kind, id } = selectedItem;
      ed.update((d) => {
        if (kind === "text") d.textOverlays = d.textOverlays.filter((x) => x.id !== id);
        else if (kind === "media") d.mediaOverlays = d.mediaOverlays.filter((x) => x.id !== id);
        else if (kind === "broll") d.broll = d.broll.filter((x) => x.id !== id);
        else if (kind === "audio") d.audio = d.audio.filter((x) => x.id !== id);
        else if (kind === "layout") {
          // Delete a Fill/Fit layer: merge its span into a neighbor (keep ≥1 segment).
          if (d.layout.length <= 1) return;
          const sorted = [...d.layout].sort((a, b) => a.start - b.start);
          const i = sorted.findIndex((s) => s.id === id);
          if (i < 0) return;
          if (i > 0) sorted[i - 1].end = sorted[i].end;
          else sorted[i + 1].start = sorted[i].start;
          d.layout = sorted.filter((s) => s.id !== id);
        }
      });
      setSelectedItem(null);
      return;
    }
    if (!selection || selection.end - selection.start < 0.05) return;
    ed.update((d) => {
      const a = editedToWindow(d, selection.start);
      const b = editedToWindow(d, selection.end);
      if (b > a) d.removed = mergeRanges([...d.removed, { start: a, end: b }]);
    });
    setSelection(null);
  }, [edit, ed, selection, selectedItem]);

  const toggleMute = useCallback(() => ed.update((d) => { d.muteBase = !d.muteBase; }), [ed]);

  const addText = useCallback(() => {
    if (!edit) return;
    ed.update((d) => {
      d.textOverlays.push({
        id: crypto.randomUUID(), text: "New text",
        start: playhead, end: Math.min(editedDuration(d), playhead + 3),
        x: 0.5, y: 0.5,
        style: { bg: "#000000", color: "#FFFFFF", sizePx: 40, bold: true, radiusPx: 8 },
      });
    });
  }, [edit, ed, playhead]);

  // Auto reframe: AI-segment the clip into Fill (speaker → 9:16 crop) / Fit (b-roll/text),
  // then drop the result into edit.layout (editable afterward via the chips + inline frame).
  const autoReframe = useCallback(async () => {
    if (!edit) return;
    setAutoframing(true);
    setAutoframeError(null);
    try {
      const res = await fetch(`/api/clip/${jobId}/${clipId}/autoframe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspect: edit.aspectRatio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Auto reframe failed.");
      const layout = (data.layout ?? []) as ClipEdit["layout"];
      if (!layout.length) throw new Error("No segments detected.");
      ed.update((d) => { d.layout = layout; });
    } catch (e) {
      setAutoframeError(e instanceof Error ? e.message : "Auto reframe failed.");
    } finally {
      setAutoframing(false);
    }
  }, [edit, ed, jobId, clipId]);

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

  // Keyboard shortcuts (configurable in Settings).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName?.match(/INPUT|TEXTAREA|SELECT/) || t?.isContentEditable) return;
      const combo = eventToCombo(e);
      const is = (a: ShortcutAction) => shortcuts[a] === combo;
      if (is("playPause")) { e.preventDefault(); setPlaying((p) => !p); }
      else if (is("prevFrame")) { e.preventDefault(); stepFrame(-1); }
      else if (is("nextFrame")) { e.preventDefault(); stepFrame(1); }
      else if (is("split")) { e.preventDefault(); splitAtPlayhead(); }
      else if (is("delete") || combo === "backspace") { e.preventDefault(); deleteSelected(); }
      else if (is("mute")) { e.preventDefault(); toggleMute(); }
      else if (is("addText")) { e.preventDefault(); addText(); }
      else if (is("undo")) { e.preventDefault(); ed.undo(); }
      else if (is("redo")) { e.preventDefault(); ed.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, stepFrame, splitAtPlayhead, deleteSelected, toggleMute, addText, ed]);

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

  const activeSeg = layoutAt(edit, playhead);

  const applySegmentMode = (mode: "fill" | "fit") => {
    const id = activeSeg?.id;
    if (!id) return;
    ed.update((d) => {
      const t = d.layout.find((s) => s.id === id);
      if (!t) return;
      t.mode = mode;
      if (mode === "fit") { t.crop = undefined; t.cropAspect = "original"; }
      t.frame = undefined;
    });
  };

  // Switch the active segment's speaker layout (3D). Multi seeds full-frame panes, then
  // refines them via speaker detection; single drops the panes. (The preview toolbar has
  // the same control; this powers the crop modal's "Enable layout".)
  const enableLayout = async (kind: LayoutKind) => {
    const id = activeSeg?.id;
    if (!id) return;
    if (kind === "single") {
      ed.update((d) => { const t = d.layout.find((s) => s.id === id); if (t) { t.kind = "single"; delete t.panes; } });
      return;
    }
    const fallback = splitSlots(kind).map(() => ({ crop: { x: 0, y: 0, w: 1, h: 1 } }));
    ed.update((d) => { const t = d.layout.find((s) => s.id === id); if (t) { t.kind = kind; t.panes = fallback; } });
    try {
      const res = await fetch(`/api/clip/${jobId}/${clipId}/speakers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, segStart: activeSeg?.start, segEnd: activeSeg?.end }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.panes) && data.panes.length) {
        ed.update((d) => { const t = d.layout.find((s) => s.id === id); if (t && t.kind === kind) t.panes = data.panes; });
      }
    } catch { /* keep the fallback panes */ }
  };

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
        <Button onClick={ed.saveNow} variant="outline" disabled={ed.saving || !ed.dirty}>
          {ed.saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : ed.dirty ? "Save changes" : "Saved"}
        </Button>
        <Button onClick={runExport}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {/* Main 3-column area */}
      <div className="flex min-h-0 flex-1">
        {/* Left: transcript (drag the right edge to resize) */}
        <div className="relative shrink-0 border-r" style={{ width: leftWidth }}>
          <div className="h-full p-4">
            <TranscriptPanel edit={edit} words={ed.words} onUpdate={ed.update} onSeek={(wt) => seek(windowToEdited(edit, wt))} playhead={playhead} />
          </div>
          <div
            onPointerDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startW = leftWidth;
              const move = (ev: PointerEvent) =>
                setLeftWidth(Math.min(680, Math.max(280, startW + (ev.clientX - startX))));
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            title="Drag to resize"
            className="absolute -right-1 top-0 z-30 h-full w-2 cursor-col-resize transition-colors hover:bg-primary/40"
          />
        </div>

        {/* Center: status + preview */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-center gap-3 border-b py-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-1">{edit.aspectRatio}</span>
            <div className="flex items-center gap-1">
              <Button onClick={() => applySegmentMode("fill")} variant={activeSeg?.mode === "fill" ? "secondary" : "ghost"} size="xs">Fill</Button>
              <Button onClick={() => applySegmentMode("fit")} variant={activeSeg?.mode === "fit" ? "secondary" : "ghost"} size="xs">Fit</Button>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <Button onClick={() => setCropOpen(true)} variant="ghost" size="xs" title="Crop / reframe">
                <Crop className="h-3.5 w-3.5" /> Crop
              </Button>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <select
                value={activeSeg?.kind ?? "single"}
                onChange={(e) => enableLayout(e.target.value as LayoutKind)}
                title="Speaker layout"
                className="rounded-md bg-transparent px-1.5 py-1 text-[11px] font-medium outline-none hover:bg-accent [&>option]:text-foreground"
              >
                <option value="single">Single</option>
                <option value="split">Split · 2</option>
                <option value="triple">Triple · 3</option>
                <option value="quad">Quad · 4</option>
              </select>
            </div>
            <Button
              onClick={autoReframe}
              disabled={autoframing}
              variant="ghost"
              size="xs"
              title={autoframeError ?? "Auto-detect Fill (speaker) / Fit (b-roll) segments with AI — editable afterward"}
            >
              {autoframing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Auto reframe
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
              onOpenCrop={() => setCropOpen(true)}
              selectedTextId={selectedTextId}
              onSelectText={(id) => setSelectedItem(id ? { kind: "text", id } : null)}
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
              {panel === "presets" && <LayerPresetsPanel edit={edit} onUpdate={ed.update} playhead={playhead} />}
              {panel === "background" && <BackgroundPanel edit={edit} onUpdate={ed.update} playhead={playhead} />}
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
        <div className="flex items-center px-4 py-2">
          <div className="flex-1" />
          {/* Centered transport + editing toolbar */}
          <div className="flex items-center gap-2">
            <Button onClick={() => stepFrame(-1)} variant="ghost" size="icon-sm" title={`Previous frame (${formatCombo(shortcuts.prevFrame)})`}><SkipBack className="h-4 w-4" /></Button>
            <Button onClick={() => setPlaying((p) => !p)} variant="secondary" size="icon" className="rounded-full" title={`Play / Pause (${formatCombo(shortcuts.playPause)})`}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button onClick={() => stepFrame(1)} variant="ghost" size="icon-sm" title={`Next frame (${formatCombo(shortcuts.nextFrame)})`}><SkipForward className="h-4 w-4" /></Button>
            <span className="ml-1 mr-1 font-mono text-xs text-muted-foreground">
              {fmt(playhead)} / {fmt(duration)}
            </span>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button onClick={splitAtPlayhead} variant="ghost" size="sm" title={`Split at playhead (${formatCombo(shortcuts.split)})`}><Scissors className="h-4 w-4" /> Split</Button>
            {toolMsg && <span className="text-xs text-amber-500">{toolMsg}</span>}
            <Button onClick={deleteSelected} variant="ghost" size="sm" disabled={!selection && !selectedItem} title={`Delete ${selectedItem ? selectedItem.kind : "selection"} (${formatCombo(shortcuts.delete)})`}><Trash2 className="h-4 w-4" /> Delete</Button>
            <Button onClick={toggleMute} variant={edit.muteBase ? "secondary" : "ghost"} size="sm" title={`Mute base audio (${formatCombo(shortcuts.mute)})`}>{edit.muteBase ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} Mute</Button>
            <Button onClick={addText} variant="ghost" size="sm" title={`Add text (${formatCombo(shortcuts.addText)})`}><Type className="h-4 w-4" /> Add</Button>
          </div>
          <div className="flex flex-1 items-center justify-end gap-1">
            <Button onClick={() => setPxPerSec((p) => Math.max(10, p - 10))} variant="ghost" size="icon-sm"><ZoomOut className="h-4 w-4" /></Button>
            <Button onClick={() => setPxPerSec((p) => Math.min(120, p + 10))} variant="ghost" size="icon-sm"><ZoomIn className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="px-2 pb-2">
          <Timeline
            jobId={jobId}
            edit={edit}
            playhead={playhead}
            pxPerSec={pxPerSec}
            onSeek={seek}
            onZoom={(dir) => setPxPerSec((p) => Math.min(160, Math.max(8, p + dir * 12)))}
            onUpdate={ed.update}
            selection={selection}
            onSelection={setSelection}
            selectedItem={selectedItem}
            onSelectItem={setSelectedItem}
            onMeta={(m) => setFps(m.sourceFps)}
          />
        </div>
      </div>

      {/* Text overlay settings popup (anchored to the right rail) */}
      {selectedTextId && edit.textOverlays.some((o) => o.id === selectedTextId) && (
        <div className="absolute right-[72px] top-24 z-40">
          <TextOverlaySettings
            overlay={edit.textOverlays.find((o) => o.id === selectedTextId)!}
            onUpdate={ed.update}
            onClose={() => setSelectedItem(null)}
            onDelete={() => {
              ed.update((d) => { d.textOverlays = d.textOverlays.filter((o) => o.id !== selectedTextId); });
              setSelectedItem(null);
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
          crop={activeSeg?.crop}
          cropAspect={activeSeg?.cropAspect}
          layoutKind={activeSeg?.kind ?? "single"}
          onEnableLayout={enableLayout}
          onClose={() => setCropOpen(false)}
          onApply={(c, cropAspect) => {
            const id = activeSeg?.id;
            ed.update((d) => {
              const t = id ? d.layout.find((s) => s.id === id) : d.layout[0];
              if (!t) return;
              t.crop = cropAspect === "original" ? undefined : c;
              t.cropAspect = cropAspect;
              // A non-output, non-custom crop ratio implies a letterboxed Fit; otherwise Fill.
              // "custom" means the user drew a free rect — keep Fill so it covers the canvas.
              const nonOutput = !!cropAspect && cropAspect !== "original" && cropAspect !== "custom" && cropAspect !== edit.aspectRatio;
              t.mode = nonOutput ? "fit" : "fill";
              t.frame = undefined; // re-derive the box from mode + new crop
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
