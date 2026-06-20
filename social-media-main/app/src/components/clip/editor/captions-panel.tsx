"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CaptionPreview } from "@/components/clip/caption-preview";
import { CAPTION_STYLES, FONT_FAMILIES, presetToCaptionConfig } from "@/lib/clip/caption-styles";
import type { ClipEdit, CaptionConfig } from "@/lib/types";

const ANIMATIONS: CaptionConfig["effects"]["animation"][] = ["none", "box", "pop", "bounce", "karaoke"];
const POSITIONS: CaptionConfig["effects"]["position"][] = ["auto", "top", "middle", "bottom"];

export function CaptionsPanel({
  edit,
  onUpdate,
}: {
  edit: ClipEdit;
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
}) {
  const [tab, setTab] = useState("presets");
  const cap = edit.caption;

  const setCaption = (patch: (c: CaptionConfig) => void) =>
    onUpdate((d) => {
      patch(d.caption);
    });

  return (
    <div className="w-[300px] space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="presets" className="flex-1">Presets</TabsTrigger>
          <TabsTrigger value="font" className="flex-1">Font</TabsTrigger>
          <TabsTrigger value="effects" className="flex-1">Effects</TabsTrigger>
        </TabsList>

        {/* Presets */}
        <TabsContent value="presets" className="pt-3">
          <div className="grid grid-cols-2 gap-2">
            {CAPTION_STYLES.map((s) => (
              <CaptionPreview
                key={s.name}
                style={s}
                selected={cap.preset === s.name}
                onSelect={() =>
                  onUpdate((d) => {
                    // Apply the preset but keep any manual offset.
                    const offset = d.caption.offset;
                    d.caption = presetToCaptionConfig(s.name);
                    d.caption.offset = offset;
                  })
                }
              />
            ))}
          </div>
        </TabsContent>

        {/* Font */}
        <TabsContent value="font" className="space-y-4 pt-3">
          <Field label="Font family">
            <Select value={cap.font.family} onValueChange={(v) => setCaption((c) => { c.font.family = v; })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Size (px)">
              <Input
                type="number" min={20} max={160}
                value={cap.font.sizePx}
                onChange={(e) => setCaption((c) => { c.font.sizePx = Number(e.target.value); })}
              />
            </Field>
            <Field label="Color">
              <ColorInput value={cap.font.color} onChange={(v) => setCaption((c) => { c.font.color = v; })} />
            </Field>
          </div>

          <Toggle label="Uppercase" on={cap.font.uppercase} onToggle={() => setCaption((c) => { c.font.uppercase = !c.font.uppercase; })} />

          <div className="flex gap-2">
            <Button
              variant={cap.font.italic ? "default" : "outline"}
              onClick={() => setCaption((c) => { c.font.italic = !c.font.italic; })}
              className="flex-1 italic"
            >I</Button>
            <Button
              variant={cap.font.underline ? "default" : "outline"}
              onClick={() => setCaption((c) => { c.font.underline = !c.font.underline; })}
              className="flex-1 underline"
            >U</Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Stroke color">
              <ColorInput value={cap.font.strokeColor} onChange={(v) => setCaption((c) => { c.font.strokeColor = v; })} />
            </Field>
            <Field label="Stroke (px)">
              <Input
                type="number" min={0} max={20}
                value={cap.font.strokeWidthPx}
                onChange={(e) => setCaption((c) => { c.font.strokeWidthPx = Number(e.target.value); })}
              />
            </Field>
          </div>

          <Toggle label="Font shadow" on={cap.font.shadow} onToggle={() => setCaption((c) => { c.font.shadow = !c.font.shadow; })} />
        </TabsContent>

        {/* Effects */}
        <TabsContent value="effects" className="space-y-4 pt-3">
          <Field label="Position">
            <div className="grid grid-cols-4 gap-1.5">
              {POSITIONS.map((p) => (
                <Button
                  key={p}
                  variant={cap.effects.position === p && !cap.offset ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCaption((c) => { c.effects.position = p; c.offset = undefined; })}
                  className="px-1 text-xs capitalize"
                >{p}</Button>
              ))}
            </div>
          </Field>

          <Field label="Animation">
            <Select value={cap.effects.animation} onValueChange={(v) => setCaption((c) => { c.effects.animation = v as CaptionConfig["effects"]["animation"]; })}>
              <SelectTrigger className="w-full capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANIMATIONS.map((a) => <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Lines">
            <div className="grid grid-cols-2 gap-1.5">
              {([3, 1] as const).map((n) => (
                <Button
                  key={n}
                  variant={cap.effects.lines === n ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCaption((c) => { c.effects.lines = n; })}
                  className="text-xs"
                >{n === 3 ? "Three lines" : "One line"}</Button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Highlight color">
              <ColorInput value={cap.effects.highlightColor} onChange={(v) => setCaption((c) => { c.effects.highlightColor = v; })} />
            </Field>
            <Field label="Word background">
              <ColorInput value={cap.effects.wordBgColor || "#000000"} onChange={(v) => setCaption((c) => { c.effects.wordBgColor = v; })} />
            </Field>
          </div>
          <Button
            variant="link"
            size="sm"
            onClick={() => setCaption((c) => { c.effects.wordBgColor = undefined; })}
            className="h-auto p-0 text-[11px] text-muted-foreground"
          >Clear word background</Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-6 cursor-pointer rounded bg-transparent" />
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <Switch checked={on} onCheckedChange={onToggle} />
    </div>
  );
}
