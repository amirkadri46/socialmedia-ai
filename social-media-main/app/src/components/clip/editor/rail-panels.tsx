"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, Loader2, Trash2, Music, Film, Image as ImageIcon } from "lucide-react";
import type { ClipEdit, TransitionMarker, AudioTrack } from "@/lib/types";

type UpdateFn = (mutator: (draft: ClipEdit) => ClipEdit | void) => void;

async function uploadAsset(clipId: string, file: File): Promise<{ src: string } | null> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/clip/asset/${clipId}`, { method: "POST", body: form });
  if (!res.ok) return null;
  return res.json();
}

// ── Media panel (image 9) ──────────────────────────────────────────────────────────

export function MediaPanel({ edit, onUpdate, playhead }: { edit: ClipEdit; onUpdate: UpdateFn; playhead: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    const up = await uploadAsset(edit.clipId, file);
    setBusy(false);
    if (!up) return;
    const kind = file.type.startsWith("video") ? "video" : "image";
    onUpdate((d) => {
      d.mediaOverlays.push({
        id: uuid(), kind, src: up.src,
        start: playhead, end: Math.min(d.durationSec, playhead + 5),
        x: 0.25, y: 0.25, w: 0.5, h: 0.3, z: 1, opacity: 1,
      });
    });
  }

  return (
    <PanelShell title="Media">
      <DropUpload accept="image/*,video/*" busy={busy} inputRef={inputRef} onFile={onFile} label="Drag files here or click to upload" />
      <p className="text-[11px] text-muted-foreground">Overlays appear on the canvas — drag to position.</p>
      <div className="space-y-1.5">
        {edit.mediaOverlays.map((m) => (
          <Row key={m.id} icon={m.kind === "video" ? <Film className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
            label={`${m.kind} · ${m.start.toFixed(1)}–${m.end.toFixed(1)}s`}
            onDelete={() => onUpdate((d) => { d.mediaOverlays = d.mediaOverlays.filter((x) => x.id !== m.id); })} />
        ))}
      </div>
    </PanelShell>
  );
}

// ── B-Roll panel (image 10 — upload only) ───────────────────────────────────────────

export function BrollPanel({ edit, onUpdate, playhead }: { edit: ClipEdit; onUpdate: UpdateFn; playhead: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    const up = await uploadAsset(edit.clipId, file);
    setBusy(false);
    if (!up) return;
    onUpdate((d) => {
      d.broll.push({ id: uuid(), src: up.src, start: playhead, end: Math.min(d.durationSec, playhead + 4), mode: "fill" });
    });
  }

  return (
    <PanelShell title="B-Roll">
      <Button onClick={() => inputRef.current?.click()} variant="outline" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload B-roll
      </Button>
      <input ref={inputRef} type="file" accept="video/*,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <p className="text-[11px] text-muted-foreground">Auto-generate AI / stock / prompt B-roll — coming later.</p>
      <div className="space-y-1.5">
        {edit.broll.map((b) => (
          <Row key={b.id} icon={<Film className="h-4 w-4" />} label={`B-roll · ${b.start.toFixed(1)}–${b.end.toFixed(1)}s`}
            onDelete={() => onUpdate((d) => { d.broll = d.broll.filter((x) => x.id !== b.id); })} />
        ))}
      </div>
    </PanelShell>
  );
}

// ── Transitions panel (image 11) ─────────────────────────────────────────────────────

const TRANSITIONS: { type: TransitionMarker["type"]; label: string }[] = [
  { type: "fade", label: "Fade in/out" },
  { type: "crossfade", label: "Cross fade" },
  { type: "crosszoom", label: "Cross zoom" },
  { type: "zoomin", label: "Zoom in" },
  { type: "zoomout", label: "Zoom out" },
];

export function TransitionsPanel({ edit, onUpdate, playhead }: { edit: ClipEdit; onUpdate: UpdateFn; playhead: number }) {
  return (
    <PanelShell title="Transitions">
      <div className="flex items-center justify-between">
        <span className="text-sm">Auto transitions</span>
        <Switch
          checked={edit.autoTransitions}
          onCheckedChange={() => onUpdate((d) => { d.autoTransitions = !d.autoTransitions; })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {TRANSITIONS.map((t) => (
          <Button
            key={t.type}
            variant="outline"
            onClick={() => onUpdate((d) => { d.transitions.push({ id: uuid(), atTime: playhead, type: t.type, durationSec: 0.5 }); })}
            className="h-auto py-3 text-xs"
          >{t.label}</Button>
        ))}
      </div>
      <div className="space-y-1.5">
        {edit.transitions.map((t) => (
          <Row key={t.id} icon={<Film className="h-4 w-4" />} label={`${t.type} @ ${t.atTime.toFixed(1)}s`}
            onDelete={() => onUpdate((d) => { d.transitions = d.transitions.filter((x) => x.id !== t.id); })} />
        ))}
      </div>
    </PanelShell>
  );
}

// ── Audio panel (image 12) ───────────────────────────────────────────────────────────

export function AudioPanel({ edit, onUpdate }: { edit: ClipEdit; onUpdate: UpdateFn; playhead: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    const up = await uploadAsset(edit.clipId, file);
    setBusy(false);
    if (!up) return;
    onUpdate((d) => {
      d.audio.push({
        id: uuid(), kind: "upload", src: up.src, label: file.name,
        start: 0, end: d.durationSec, gain: 0.7, fadeInSec: 0.5, fadeOutSec: 0.5, duckUnderSpeech: true,
      });
    });
  }

  return (
    <PanelShell title="Audio">
      <Button onClick={() => inputRef.current?.click()} variant="outline" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload music / SFX
      </Button>
      <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <p className="text-[11px] text-muted-foreground">A royalty-free music library is a pending asset dependency — upload your own for now.</p>
      <div className="space-y-2">
        {edit.audio.map((a) => (
          <div key={a.id} className="rounded-md border bg-card p-2">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{a.label || a.kind}</span>
              <Button onClick={() => onUpdate((d) => { d.audio = d.audio.filter((x) => x.id !== a.id); })} variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Vol</span>
              <Slider min={0} max={1} step={0.05} value={[a.gain]}
                onValueChange={([v]) => onUpdate((d) => { const t = d.audio.find((x) => x.id === a.id) as AudioTrack; if (t) t.gain = v; })}
                className="flex-1" />
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Checkbox checked={!!a.duckUnderSpeech}
                  onCheckedChange={(c) => onUpdate((d) => { const t = d.audio.find((x) => x.id === a.id) as AudioTrack; if (t) t.duckUnderSpeech = c === true; })} />
                duck
              </label>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────────────

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-[300px] space-y-3">
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </div>
  );
}

function DropUpload({ accept, busy, inputRef, onFile, label }: {
  accept: string; busy: boolean; inputRef: React.RefObject<HTMLInputElement | null>; onFile: (f: File) => void; label: string;
}) {
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]); }}
        onDragOver={(e) => e.preventDefault()}
        className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed py-8 text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent/50"
      >
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
        <span className="text-sm">{label}</span>
      </button>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </>
  );
}

function Row({ icon, label, onDelete }: { icon: React.ReactNode; label: string; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
      <Button onClick={onDelete} variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
