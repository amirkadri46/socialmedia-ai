"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, Loader2, Trash2, Music, Film, Image as ImageIcon, Sparkles, Plus, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ClipEdit, TransitionMarker, AudioTrack } from "@/lib/types";
import { DEFAULT_BLUR_BG } from "@/lib/types";
import { loadPresets, savePresets, defaultPreset, presetToOverlays, type LayerPreset, type PresetLayer } from "@/lib/clip/layer-presets";

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
      // Default to the full 9:16 frame (image/video fills the canvas); drag/resize to inset.
      d.mediaOverlays.push({
        id: uuid(), kind, src: up.src,
        start: playhead, end: Math.min(d.durationSec, playhead + 5),
        x: 0, y: 0, w: 1, h: 1, z: 1, opacity: 1,
      });
    });
  }

  return (
    <PanelShell title="Media">
      <DropUpload accept="image/*,video/*" busy={busy} inputRef={inputRef} onFile={onFile} label="Drag files here or click to upload" />
      <AiGenerateButton label="AI generate image / video" />
      <p className="text-[11px] text-muted-foreground">Overlays fill the 9:16 frame — drag a corner to inset.</p>
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
      <AiGenerateButton label="AI generate B-roll" />
      <p className="text-[11px] text-muted-foreground">Uploaded B-roll fills the 9:16 frame on its range.</p>
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
  { type: "fadein", label: "Fade in" },
  { type: "fadeout", label: "Fade out" },
  { type: "crossfade", label: "Cross fade" },
  { type: "crosszoom", label: "Cross zoom" },
  { type: "zoomin", label: "Zoom in" },
  { type: "zoomout", label: "Zoom out" },
];
const TRANSITION_LABEL = Object.fromEntries(TRANSITIONS.map((t) => [t.type, t.label])) as Record<TransitionMarker["type"], string>;

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
            onClick={() => onUpdate((d) => { d.transitions.push({ id: uuid(), atTime: playhead, type: t.type, durationSec: 3 }); })}
            className="h-auto py-3 text-xs"
          >{t.label}</Button>
        ))}
      </div>
      <div className="space-y-1.5">
        {edit.transitions.map((t) => (
          <div key={t.id} className="space-y-1.5 rounded-md border bg-card p-2">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs">{TRANSITION_LABEL[t.type]} @ {t.atTime.toFixed(1)}s</span>
              <Button
                onClick={() => onUpdate((d) => { d.transitions = d.transitions.filter((x) => x.id !== t.id); })}
                variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 text-[10px] text-muted-foreground">Duration</span>
              <Slider min={0.05} max={5} step={0.05} value={[t.durationSec]}
                onValueChange={([v]) => onUpdate((d) => { const x = d.transitions.find((x) => x.id === t.id); if (x) x.durationSec = v; })}
                className="flex-1" />
              <span className="w-8 text-[10px] text-muted-foreground">{t.durationSec.toFixed(1)}s</span>
            </div>
          </div>
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

// ── Layer Presets panel (reusable branding overlays) ─────────────────────────────────

export function LayerPresetsPanel({ edit, onUpdate }: { edit: ClipEdit; onUpdate: UpdateFn; playhead: number }) {
  // Presets persist across projects in localStorage (read once on mount; this client-only
  // panel mounts on demand, so a lazy initializer is safe and avoids an effect).
  const [presets, setPresets] = useState<LayerPreset[]>(() => loadPresets());
  const [openId, setOpenId] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const commit = (next: LayerPreset[]) => { setPresets(next); savePresets(next); };
  const patchPreset = (id: string, fn: (p: LayerPreset) => LayerPreset) =>
    commit(presets.map((p) => (p.id === id ? fn(p) : p)));
  const patchLayer = (pid: string, lid: string, patch: Partial<PresetLayer>) =>
    patchPreset(pid, (p) => ({ ...p, layers: p.layers.map((l) => (l.id === lid ? { ...l, ...patch } : l)) }));

  const apply = (preset: LayerPreset) => {
    const overlays = presetToOverlays(preset, edit.durationSec);
    if (!overlays.length) return;
    onUpdate((d) => { d.textOverlays.push(...overlays); });
    setApplied(preset.id);
    setTimeout(() => setApplied((v) => (v === preset.id ? null : v)), 1500);
  };

  const addPreset = () => {
    const p = { ...defaultPreset(), name: `Preset ${presets.length + 1}` };
    commit([...presets, p]);
    setOpenId(p.id);
  };

  return (
    <PanelShell title="Layer presets">
      <p className="text-[11px] text-muted-foreground">
        One-click branding overlays (banner, logo, handle, watermark). Applied layers become normal,
        editable overlays on the canvas. Presets are saved across all your projects.
      </p>
      <div className="space-y-2">
        {presets.map((preset) => {
          const open = openId === preset.id;
          const onCount = preset.layers.filter((l) => l.enabled).length;
          return (
            <div key={preset.id} className="rounded-md border bg-card">
              <div className="flex items-center gap-1.5 p-2">
                <button onClick={() => setOpenId(open ? null : preset.id)} className="text-muted-foreground">
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <Input
                  value={preset.name}
                  onChange={(e) => patchPreset(preset.id, (p) => ({ ...p, name: e.target.value }))}
                  className="h-7 border-0 bg-transparent px-1 text-xs font-medium shadow-none focus-visible:ring-0"
                />
                <span className="shrink-0 text-[10px] text-muted-foreground">{onCount} on</span>
                <Button onClick={() => apply(preset)} size="xs" variant={applied === preset.id ? "secondary" : "outline"} className="shrink-0">
                  {applied === preset.id ? <Check className="h-3.5 w-3.5" /> : null} Apply
                </Button>
                <Button
                  onClick={() => commit(presets.filter((p) => p.id !== preset.id))}
                  size="icon-xs" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive"
                  title="Delete preset"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {open && (
                <div className="space-y-2 border-t p-2">
                  {preset.layers.map((l) => (
                    <div key={l.id} className="space-y-1.5 rounded-md bg-muted/40 p-2">
                      <div className="flex items-center gap-2">
                        <Checkbox checked={l.enabled} onCheckedChange={(c) => patchLayer(preset.id, l.id, { enabled: c === true })} />
                        <span className="flex-1 text-[11px] font-medium">{l.label}</span>
                      </div>
                      {l.text !== undefined && l.type !== "banner" && (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={l.text}
                            onChange={(e) => patchLayer(preset.id, l.id, { text: e.target.value })}
                            className="h-7 flex-1 text-[11px]"
                            placeholder="Text"
                          />
                          {l.color !== undefined && (
                            <input
                              type="color"
                              value={l.color}
                              onChange={(e) => patchLayer(preset.id, l.id, { color: e.target.value })}
                              className="h-7 w-7 cursor-pointer rounded border bg-transparent"
                              title="Color"
                            />
                          )}
                        </div>
                      )}
                      {(l.type === "banner") && l.bg !== undefined && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">Strip color</span>
                          <input type="color" value={l.bg.slice(0, 7)} onChange={(e) => patchLayer(preset.id, l.id, { bg: e.target.value })}
                            className="h-7 w-7 cursor-pointer rounded border bg-transparent" />
                        </div>
                      )}
                      {l.opacity !== undefined && (
                        <SliderRow label="Opacity" min={0} max={1} step={0.02} value={l.opacity}
                          fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchLayer(preset.id, l.id, { opacity: v })} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button onClick={addPreset} variant="outline" className="w-full">
        <Plus className="h-4 w-4" /> New preset
      </Button>
    </PanelShell>
  );
}

// ── Background panel (auto blurred background for Fit videos) ─────────────────────────

export function BackgroundPanel({ edit, onUpdate }: { edit: ClipEdit; onUpdate: UpdateFn; playhead: number }) {
  const bg = edit.blurBg ?? { ...DEFAULT_BLUR_BG, enabled: false };
  const set = (patch: Partial<typeof bg>) =>
    onUpdate((d) => { d.blurBg = { ...(d.blurBg ?? DEFAULT_BLUR_BG), ...patch }; });

  return (
    <PanelShell title="Background">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">Auto blurred background</p>
          <p className="text-[11px] text-muted-foreground">Fills the bars on Fit videos with a blurred copy of the frame.</p>
        </div>
        <Switch checked={!!bg.enabled} onCheckedChange={(c) => set({ enabled: c === true })} />
      </div>
      <div className={bg.enabled ? "space-y-3" : "pointer-events-none space-y-3 opacity-40"}>
        <SliderRow label="Blur" min={0} max={100} step={1} value={bg.blur} fmt={(v) => String(Math.round(v))} onChange={(v) => set({ blur: v })} />
        <SliderRow label="Scale" min={1} max={2.5} step={0.05} value={bg.scale} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ scale: v })} />
        <SliderRow label="Bright" min={0.3} max={1.5} step={0.05} value={bg.brightness} fmt={(v) => v.toFixed(2)} onChange={(v) => set({ brightness: v })} />
        <SliderRow label="Opacity" min={0} max={1} step={0.05} value={bg.opacity} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ opacity: v })} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Applies to single-layout segments in <span className="font-medium">Fit</span> mode. Switch a segment to Fill to remove its background.
      </p>
    </PanelShell>
  );
}

function SliderRow({ label, min, max, step, value, fmt, onChange }: {
  label: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[11px] text-muted-foreground">{label}</span>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} className="flex-1" />
      <span className="w-10 text-right text-[11px] text-muted-foreground">{fmt(value)}</span>
    </div>
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

// AI-generated image/video source — placeholder until generation is wired (3B.4).
function AiGenerateButton({ label }: { label: string }) {
  return (
    <Button variant="outline" className="w-full justify-start opacity-50" disabled title={`${label} — coming soon`}>
      <Sparkles className="h-4 w-4" /> {label} <span className="ml-auto text-[10px] uppercase tracking-wide">soon</span>
    </Button>
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
