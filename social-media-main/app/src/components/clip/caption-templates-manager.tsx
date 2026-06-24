"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Copy, Loader2, Plus, Trash2, Check } from "lucide-react";
import type { CaptionPromptTemplate } from "@/lib/types";

interface DraftTemplate {
  id?: string;
  name: string;
  creator: string;
  context: string;
  brandVoice: string;
  cta: string;
  hashtags: string;
  includeHashtags: boolean;
}

const EMPTY_DRAFT: DraftTemplate = {
  name: "",
  creator: "",
  context: "",
  brandVoice: "",
  cta: "",
  hashtags: "",
  includeHashtags: true,
};

function toDraft(t: CaptionPromptTemplate): DraftTemplate {
  return {
    id: t.id,
    name: t.name,
    creator: t.creator || "",
    context: t.context || "",
    brandVoice: t.brandVoice || "",
    cta: t.cta || "",
    hashtags: t.hashtags || "",
    includeHashtags: t.includeHashtags,
  };
}

export function CaptionTemplatesManager({
  open,
  onClose,
  onTemplatesChange,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the latest list whenever templates change (create/update/duplicate/delete). */
  onTemplatesChange: (templates: CaptionPromptTemplate[]) => void;
  /** "Use this template" — select it back in the schedule dialog. */
  onApply?: (id: string) => void;
}) {
  const [templates, setTemplates] = useState<CaptionPromptTemplate[]>([]);
  const [draft, setDraft] = useState<DraftTemplate>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/clip/social/caption-templates")
      .then((r) => r.json())
      .then((list: CaptionPromptTemplate[]) => {
        setTemplates(list);
        // Open the first template for editing, else a blank "new" draft.
        setDraft(list.length ? toDraft(list[0]) : EMPTY_DRAFT);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  function refresh(list: CaptionPromptTemplate[]) {
    setTemplates(list);
    onTemplatesChange(list);
  }

  function field<K extends keyof DraftTemplate>(key: K, value: DraftTemplate[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error("Give the template a name (e.g. @speed).");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/clip/social/caption-templates", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const saved = (await res.json()) as CaptionPromptTemplate & { error?: string };
      if (!res.ok) {
        toast.error(saved.error || "Failed to save template.");
        return;
      }
      const list = draft.id
        ? templates.map((t) => (t.id === saved.id ? saved : t))
        : [saved, ...templates];
      refresh(list);
      setDraft(toDraft(saved));
      toast.success(draft.id ? "Template updated." : "Template created.");
    } catch {
      toast.error("Failed to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicate(t: CaptionPromptTemplate) {
    setSaving(true);
    try {
      const res = await fetch("/api/clip/social/caption-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toDraft(t), id: undefined, name: `${t.name} copy` }),
      });
      const saved = (await res.json()) as CaptionPromptTemplate & { error?: string };
      if (!res.ok) {
        toast.error(saved.error || "Failed to duplicate.");
        return;
      }
      refresh([saved, ...templates]);
      setDraft(toDraft(saved));
      toast.success("Template duplicated.");
    } catch {
      toast.error("Failed to duplicate.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const prev = templates;
    const list = templates.filter((t) => t.id !== id);
    refresh(list);
    if (draft.id === id) setDraft(list.length ? toDraft(list[0]) : EMPTY_DRAFT);
    try {
      const res = await fetch(`/api/clip/social/caption-templates?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Template deleted.");
    } catch {
      refresh(prev); // roll back the optimistic removal
      toast.error("Failed to delete template.");
    }
  }

  const isNew = !draft.id;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Caption templates</DialogTitle>
          <DialogDescription>
            Reusable per-creator context (bio, niche, audience, CTA, hashtags, brand voice). Captions
            stay on-brand across clips — only the clip title, topic, and hook change.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[220px_1fr]">
          {/* Template list */}
          <div className="space-y-1.5 overflow-y-auto max-h-[60vh] pr-1">
            <Button
              variant={isNew ? "default" : "outline"}
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => setDraft(EMPTY_DRAFT)}
            >
              <Plus className="h-4 w-4" /> New template
            </Button>
            {loading && (
              <p className="px-1 py-2 text-xs text-muted-foreground">Loading…</p>
            )}
            {!loading && templates.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No templates yet. Create one for a creator to reuse across all their clips.
              </p>
            )}
            {templates.map((t) => {
              const active = draft.id === t.id;
              return (
                <div
                  key={t.id}
                  className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 ${
                    active ? "border-primary bg-primary/10" : "border-transparent hover:bg-accent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setDraft(toDraft(t))}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    {t.creator && (
                      <p className="truncate text-xs text-muted-foreground">{t.creator}</p>
                    )}
                  </button>
                  <button
                    type="button"
                    title="Duplicate"
                    onClick={() => duplicate(t)}
                    className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => remove(t.id)}
                    className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Editor form */}
          <div className="space-y-3 overflow-y-auto max-h-[60vh] pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Template name</Label>
                <Input
                  id="tpl-name"
                  value={draft.name}
                  onChange={(e) => field("name", e.target.value)}
                  placeholder="@speed"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-creator">Creator</Label>
                <Input
                  id="tpl-creator"
                  value={draft.creator}
                  onChange={(e) => field("creator", e.target.value)}
                  placeholder="Speed / @speed"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-context">Creator context</Label>
              <Textarea
                id="tpl-context"
                value={draft.context}
                onChange={(e) => field("context", e.target.value)}
                rows={6}
                placeholder={
                  "Bio, niche, audience, achievements, follower count…\n\nExample:\nSpeed is a 22-year-old gaming & lifestyle creator with 30M followers. Audience is Gen-Z gamers. Known for high-energy reactions and football content. Recently hit 1B views."
                }
              />
              <p className="text-xs text-muted-foreground">
                This stays identical across every clip — it&apos;s what keeps captions on-brand.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-voice">Brand voice</Label>
                <Input
                  id="tpl-voice"
                  value={draft.brandVoice}
                  onChange={(e) => field("brandVoice", e.target.value)}
                  placeholder="High-energy, hype, emojis"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-cta">Call to action</Label>
                <Input
                  id="tpl-cta"
                  value={draft.cta}
                  onChange={(e) => field("cta", e.target.value)}
                  placeholder="Follow for daily clips"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="tpl-hashtags">Hashtags</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="tpl-include-hashtags" className="text-xs font-normal text-muted-foreground">
                    Include in captions
                  </Label>
                  <Switch
                    id="tpl-include-hashtags"
                    checked={draft.includeHashtags}
                    onCheckedChange={(v) => field("includeHashtags", v)}
                  />
                </div>
              </div>
              <Textarea
                id="tpl-hashtags"
                value={draft.hashtags}
                onChange={(e) => field("hashtags", e.target.value)}
                rows={2}
                placeholder="#gaming #speed #football #viral"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {!isNew && onApply && draft.id && (
                <Button
                  variant="outline"
                  onClick={() => {
                    onApply(draft.id!);
                    onClose();
                  }}
                  className="mr-auto"
                >
                  <Check className="h-4 w-4" /> Use this template
                </Button>
              )}
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isNew ? "Create template" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
