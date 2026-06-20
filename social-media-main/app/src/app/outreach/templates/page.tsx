"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
    <div className="space-y-5 mt-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Template Name *</Label>
          <Input
            value={form.offerName}
            onChange={(e) => setField("offerName", e.target.value)}
            placeholder="e.g. SaaS Founders — LinkedIn"
            className="rounded-xl glass border-white/[0.08] h-10"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Channel Focus</Label>
          <Select
            value={form.channelFocus}
            onValueChange={(v) => setField("channelFocus", v as OfferTemplate["channelFocus"])}
          >
            <SelectTrigger className="rounded-xl glass border-white/[0.08] h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong rounded-xl border-white/[0.08]">
              {CHANNEL_OPTIONS.map((c) => (
                <SelectItem key={c} value={c} className="rounded-lg cursor-pointer">
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
            className="rounded-xl glass border-white/[0.08] h-10"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Tone</Label>
          <Input
            value={form.tone}
            onChange={(e) => setField("tone", e.target.value)}
            placeholder="casual-direct"
            className="rounded-xl glass border-white/[0.08] h-10"
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
          className="rounded-xl glass border-white/[0.08] resize-none text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Call to Action</Label>
        <Input
          value={form.cta}
          onChange={(e) => setField("cta", e.target.value)}
          placeholder="Worth a quick chat?"
          className="rounded-xl glass border-white/[0.08] h-10"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Proof Points / Results (optional)</Label>
        <Textarea
          value={form.proofPoints ?? ""}
          onChange={(e) => setField("proofPoints", e.target.value)}
          placeholder="e.g. Built 12 SaaS landing pages, avg 38% conversion lift"
          rows={2}
          className="rounded-xl glass border-white/[0.08] resize-none text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Dos & Don'ts (optional)</Label>
        <Textarea
          value={form.dosAndDonts ?? ""}
          onChange={(e) => setField("dosAndDonts", e.target.value)}
          placeholder={"Do: mention their specific industry\nDon't: use the phrase 'touch base'"}
          rows={3}
          className="rounded-xl glass border-white/[0.08] resize-none text-sm"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setField("isActive", e.target.checked)}
            className="rounded"
          />
          <span className="text-sm">Set as active template</span>
        </label>
      </div>

      <div className="flex gap-3 pt-2">
        <Button
          onClick={handleSave}
          disabled={saving || !form.offerName.trim()}
          className="flex-1 rounded-xl h-10 border-0 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {saving ? "Saving…" : "Save Template"}
        </Button>
        <Button
          variant="ghost"
          onClick={onClose}
          className="rounded-xl h-10 glass border-white/[0.08]"
        >
          Cancel
        </Button>
      </div>
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

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/outreach/templates");
    if (res.ok) setTemplates(await res.json());
    setLoading(false);
  };

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
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define your offer and value props — the active template is injected into every draft
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl h-10 border-0 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700">
              <Plus className="h-4 w-4 mr-2" />
              Add Template
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-strong border-white/[0.08] rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto">
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
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <div className="glass rounded-2xl flex flex-col items-center justify-center py-20 gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05] border border-white/[0.08]">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">No templates yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add your first template to start drafting personalised messages
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          {templates.map((t) => (
            <div key={t.id} className="glass rounded-2xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20">
                    <FileText className="h-4 w-4 text-purple-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{t.offerName}</p>
                      {t.isActive && (
                        <Badge className="rounded-lg px-2 py-0.5 text-[10px] bg-green-500/15 text-green-400 border border-green-500/30">
                          Active
                        </Badge>
                      )}
                      <Badge className="rounded-lg px-2 py-0.5 text-[10px] bg-white/[0.05] border border-white/[0.08] text-muted-foreground">
                        {t.channelFocus}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Sells: {t.whatYouSell} · Tone: {t.tone}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!t.isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetActive(t)}
                      disabled={activating === t.id}
                      className="rounded-xl h-8 text-xs glass border-white/[0.08] text-muted-foreground hover:text-foreground"
                    >
                      {activating === t.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      )}
                      Set active
                    </Button>
                  )}
                  <button
                    onClick={() => setEditTarget(t)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-all"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    disabled={deleting === t.id}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    {deleting === t.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Value props preview */}
              {t.valueProps.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-12">
                  {t.valueProps.filter(Boolean).map((v, i) => (
                    <span
                      key={i}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.07] text-muted-foreground"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-4 pl-12">
                <p className="text-[11px] text-muted-foreground">
                  CTA: <span className="text-foreground/70">{t.cta}</span>
                </p>
                {t.proofPoints && (
                  <p className="text-[11px] text-muted-foreground truncate max-w-xs">
                    Proof: <span className="text-foreground/70">{t.proofPoints}</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="glass-strong border-white/[0.08] rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto">
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
