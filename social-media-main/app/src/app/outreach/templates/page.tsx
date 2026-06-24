"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import type { OfferTemplate } from "@/lib/types";

const CHANNEL_OPTIONS = ["LinkedIn", "Instagram", "X", "Email"] as const;

const EMPTY_FORM: Omit<OfferTemplate, "id" | "createdAt"> = {
  offerName: "",
  whatYouSell: "website design",
  channelFocus: "LinkedIn",
  valueProps: [""],
  tone: "casual-direct",
  cta: "Worth a quick chat?",
  proofPoints: "",
  dosAndDonts: "",
  isActive: false,
};

function TemplateForm({
  initial,
  onSave,
  onClose,
}: {
  initial: Omit<OfferTemplate, "id" | "createdAt">;
  onSave: (data: Omit<OfferTemplate, "id" | "createdAt">) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.offerName.trim()) return;
    setSaving(true);
    await onSave({ ...form, valueProps: form.valueProps.filter((v) => v.trim()) });
    setSaving(false);
    onClose();
  };

  return (
    <div className="mt-2 space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Template Name *</Label>
          <Input
            value={form.offerName}
            onChange={(e) => setField("offerName", e.target.value)}
            placeholder="e.g. SaaS Founders — LinkedIn"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Channel Focus</Label>
          <Select
            value={form.channelFocus}
            onValueChange={(v) => setField("channelFocus", v as OfferTemplate["channelFocus"])}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">What You Sell</Label>
          <Input
            value={form.whatYouSell}
            onChange={(e) => setField("whatYouSell", e.target.value)}
            placeholder="website design"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Tone</Label>
          <Input
            value={form.tone}
            onChange={(e) => setField("tone", e.target.value)}
            placeholder="casual-direct"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Value Propositions (one per line)</Label>
        <Textarea
          value={form.valueProps.join("\n")}
          onChange={(e) => setField("valueProps", e.target.value.split("\n"))}
          placeholder={"conversion-focused design\nfast turnaround (2–3 weeks)\nbuilt for founders who need credibility fast"}
          rows={4}
          className="resize-none text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Call to Action</Label>
        <Input
          value={form.cta}
          onChange={(e) => setField("cta", e.target.value)}
          placeholder="Worth a quick chat?"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Proof Points / Results (optional)</Label>
        <Textarea
          value={form.proofPoints ?? ""}
          onChange={(e) => setField("proofPoints", e.target.value)}
          placeholder="e.g. Built 12 SaaS landing pages, avg 38% conversion lift"
          rows={2}
          className="resize-none text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Dos &amp; Don&apos;ts (optional)</Label>
        <Textarea
          value={form.dosAndDonts ?? ""}
          onChange={(e) => setField("dosAndDonts", e.target.value)}
          placeholder={"Do: mention their specific industry\nDon't: use the phrase 'touch base'"}
          rows={3}
          className="resize-none text-sm"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Switch
          id="set-active"
          checked={form.isActive}
          onCheckedChange={(v) => setField("isActive", v)}
        />
        <Label htmlFor="set-active" className="cursor-pointer text-sm">Set as active template</Label>
      </div>

      <DialogFooter className="pt-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !form.offerName.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {saving ? "Saving…" : "Save Template"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OfferTemplate | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);

  const load = () =>
    fetch("/api/outreach/templates")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: OfferTemplate[]) => {
        setTemplates(data);
        setLoading(false);
      });

  useEffect(() => { load(); }, []);

  const handleAdd = async (data: Omit<OfferTemplate, "id" | "createdAt">) => {
    await fetch("/api/outreach/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    await load();
    setAddOpen(false);
  };

  const handleEdit = async (data: Omit<OfferTemplate, "id" | "createdAt">) => {
    if (!editTarget) return;
    await fetch("/api/outreach/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editTarget, ...data }),
    });
    await load();
    setEditTarget(null);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    await fetch(`/api/outreach/templates?id=${id}`, { method: "DELETE" });
    await load();
    setDeleting(null);
  };

  const handleSetActive = async (template: OfferTemplate) => {
    setActivating(template.id);
    await fetch("/api/outreach/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...template, isActive: true }),
    });
    await load();
    setActivating(null);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define your offer and value props — the active template is injected into every draft
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              Add Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Template</DialogTitle>
            </DialogHeader>
            <TemplateForm
              initial={{ ...EMPTY_FORM }}
              onSave={handleAdd}
              onClose={() => setAddOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border py-20">
          <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted/40">
            <FileText className="size-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">No templates yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first template to start drafting personalised messages
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl border bg-muted/40">
                    <FileText className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {t.offerName}
                      {t.isActive && (
                        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Active</Badge>
                      )}
                      <Badge variant="secondary">{t.channelFocus}</Badge>
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      Sells: {t.whatYouSell} · Tone: {t.tone}
                    </CardDescription>
                  </div>
                </div>
                <CardAction>
                  <div className="flex items-center gap-1.5">
                    {!t.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetActive(t)}
                        disabled={activating === t.id}
                      >
                        {activating === t.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        Set active
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditTarget(t)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                    >
                      {deleting === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                    </Button>
                  </div>
                </CardAction>
              </CardHeader>

              <CardContent className="space-y-3">
                {t.valueProps.filter(Boolean).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {t.valueProps.filter(Boolean).map((v, i) => (
                      <Badge key={i} variant="outline" className="font-normal text-muted-foreground">
                        {v}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <p>CTA: <span className="text-foreground">{t.cta}</span></p>
                  {t.proofPoints && (
                    <p className="max-w-xs truncate">Proof: <span className="text-foreground">{t.proofPoints}</span></p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <TemplateForm
              initial={{
                offerName: editTarget.offerName,
                whatYouSell: editTarget.whatYouSell,
                channelFocus: editTarget.channelFocus,
                valueProps: editTarget.valueProps,
                tone: editTarget.tone,
                cta: editTarget.cta,
                proofPoints: editTarget.proofPoints,
                dosAndDonts: editTarget.dosAndDonts,
                isActive: editTarget.isActive,
              }}
              onSave={handleEdit}
              onClose={() => setEditTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
