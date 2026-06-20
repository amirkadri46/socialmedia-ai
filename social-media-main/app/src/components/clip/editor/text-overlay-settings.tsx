"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Trash2 } from "lucide-react";
import { FONT_FAMILIES } from "@/lib/clip/caption-styles";
import type { ClipEdit, TextOverlay } from "@/lib/types";

/** Popup editor for a selected text overlay (images 3,4). */
export function TextOverlaySettings({
  overlay,
  onUpdate,
  onClose,
  onDelete,
}: {
  overlay: TextOverlay;
  onUpdate: (mutator: (draft: ClipEdit) => ClipEdit | void) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const set = (patch: (o: TextOverlay) => void) =>
    onUpdate((d) => {
      const o = d.textOverlays.find((x) => x.id === overlay.id);
      if (o) patch(o);
    });

  const s = overlay.style;

  return (
    <div className="absolute right-full top-0 z-30 mr-2 w-[300px] space-y-4 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Text overlay settings</p>
        <Button onClick={onClose} variant="ghost" size="icon-sm"><X className="h-4 w-4" /></Button>
      </div>

      <Textarea
        value={overlay.text}
        onChange={(e) => set((o) => { o.text = e.target.value; })}
        rows={2}
      />

      <Select value={s.font ?? "Montserrat"} onValueChange={(v) => set((o) => { o.style.font = v; })}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_FAMILIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <input type="color" value={s.color} onChange={(e) => set((o) => { o.style.color = e.target.value; })} className="h-9 w-9 cursor-pointer rounded bg-transparent" />
        <Input type="number" min={12} max={160} value={s.sizePx} onChange={(e) => set((o) => { o.style.sizePx = Number(e.target.value); })} className="w-20" />
        <span className="text-xs text-muted-foreground">px</span>
        <Button variant={s.bold ? "default" : "outline"} size="icon-sm" onClick={() => set((o) => { o.style.bold = !o.style.bold; })} className="ml-auto font-bold">B</Button>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Decoration</Label>
        <div className="mt-1 flex gap-2">
          <ToggleBtn on={!!s.italic} onClick={() => set((o) => { o.style.italic = !o.style.italic; })}><Italic className="h-4 w-4" /></ToggleBtn>
          <ToggleBtn on={!!s.underline} onClick={() => set((o) => { o.style.underline = !o.style.underline; })}><Underline className="h-4 w-4" /></ToggleBtn>
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Text alignment</Label>
        <div className="mt-1 flex gap-2">
          {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Icon]) => (
            <ToggleBtn key={a} on={(s.align ?? "center") === a} onClick={() => set((o) => { o.style.align = a; })}><Icon className="h-4 w-4" /></ToggleBtn>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Word&apos;s background color</Label>
        <div className="flex items-center gap-2">
          <input type="color" value={s.bg ?? "#000000"} onChange={(e) => set((o) => { o.style.bg = e.target.value; })} className="h-7 w-7 cursor-pointer rounded-full bg-transparent" />
          <Button variant="link" size="sm" onClick={() => set((o) => { o.style.bg = undefined; })} className="h-auto p-0 text-[11px] text-muted-foreground">none</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Radius</Label>
          <Input type="number" min={0} max={40} value={s.radiusPx} onChange={(e) => set((o) => { o.style.radiusPx = Number(e.target.value); })} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Width %</Label>
          <Input type="number" min={10} max={100} value={s.widthPct ?? 80} onChange={(e) => set((o) => { o.style.widthPct = Number(e.target.value); })} className="mt-1" />
        </div>
      </div>

      <Button onClick={onDelete} variant="outline" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive">
        <Trash2 className="h-4 w-4" /> Delete text
      </Button>
    </div>
  );
}

function ToggleBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant={on ? "default" : "outline"} size="sm" onClick={onClick} className="h-9 flex-1">
      {children}
    </Button>
  );
}
