"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Mail,
  Upload,
  Loader2,
  ExternalLink,
  Copy,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  X,
  Search,
  Trash2,
  Sparkles,
} from "lucide-react";
import type { Prospect, ProspectList } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ListMeta {
  id: string;
  name: string;
  createdAt: string;
  count: number;
}

interface ImportState {
  step: "upload" | "mapping" | "confirm";
  listName: string;
  csvText: string;
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  preview: Record<string, string>[];
  mapping: Record<string, string>;
}

const PROSPECT_FIELDS = [
  "fullName",
  "firstName",
  "headline",
  "company",
  "jobTitle",
  "location",
  "profileUrl",
  "email",
  "bio",
  "website",
  "followers",
  "skip",
];

const FIELD_LABELS: Record<string, string> = {
  fullName: "Full Name",
  firstName: "First Name",
  headline: "Headline / Title",
  company: "Company",
  jobTitle: "Job Title",
  location: "Location",
  profileUrl: "Profile URL",
  email: "Email",
  bio: "Bio / About",
  website: "Website",
  followers: "Followers",
  skip: "— Skip (save to raw data) —",
};

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Prospect["draftStatus"] }) {
  const styles: Record<Prospect["draftStatus"], string> = {
    idle: "bg-white/[0.05] border-white/[0.08] text-muted-foreground",
    drafting: "bg-yellow-500/15 border-yellow-500/30 text-yellow-400",
    done: "bg-green-500/15 border-green-500/30 text-green-400",
    error: "bg-red-500/15 border-red-500/30 text-red-400",
  };
  const labels: Record<Prospect["draftStatus"], string> = {
    idle: "Idle",
    drafting: "Drafting…",
    done: "Done",
    error: "Error",
  };
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-medium border ${styles[status]}`}
    >
      {status === "drafting" && <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />}
      {status === "error" && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
      {labels[status]}
    </span>
  );
}

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-all"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ── Side panel ────────────────────────────────────────────────────────────────

function SidePanel({
  prospect,
  listId,
  charLimit,
  onClose,
  onUpdated,
}: {
  prospect: Prospect;
  listId: string;
  charLimit: number;
  onClose: () => void;
  onUpdated: (p: Partial<Prospect>) => void;
}) {
  const [linkedin, setLinkedin] = useState(prospect.linkedinMessage ?? "");
  const [email, setEmail] = useState(prospect.emailMessage ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch("/api/outreach/lists", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listId,
        prospectId: prospect.id,
        updates: { linkedinMessage: linkedin, emailMessage: email },
      }),
    });
    onUpdated({ linkedinMessage: linkedin, emailMessage: email });
    setSaving(false);
  };

  const linkedinOver = linkedin.length > charLimit;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[480px] glass-strong border-l border-white/[0.08] flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div>
          <p className="text-sm font-semibold">{prospect.fullName || "Prospect"}</p>
          <p className="text-[11px] text-muted-foreground">
            {prospect.company || prospect.headline || ""}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-all"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {/* LinkedIn DM */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">LinkedIn DM</Label>
            <div className="flex items-center gap-2">
              <span
                className={`text-[11px] tabular-nums ${
                  linkedinOver ? "text-red-400 font-semibold" : "text-muted-foreground"
                }`}
              >
                {linkedin.length} / {charLimit}
              </span>
              {linkedin && <CopyButton text={linkedin} />}
            </div>
          </div>
          <textarea
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            rows={5}
            className={`w-full rounded-xl glass text-sm p-3 resize-none outline-none transition-all ${
              linkedinOver
                ? "border border-red-500/50 focus:border-red-500/70"
                : "border border-white/[0.08] focus:border-purple-500/50"
            }`}
          />
          {linkedinOver && (
            <p className="text-[11px] text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {linkedin.length - charLimit} characters over the limit
            </p>
          )}
        </div>

        {/* Email */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Cold Email</Label>
            {email && <CopyButton text={email} />}
          </div>
          <textarea
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            rows={10}
            className="w-full rounded-xl glass border border-white/[0.08] focus:border-purple-500/50 text-sm p-3 resize-none outline-none transition-all"
          />
        </div>
      </div>

      <div className="px-5 py-4 border-t border-white/[0.06]">
        <Button
          onClick={save}
          disabled={saving}
          className="w-full rounded-xl h-10 border-0 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {saving ? "Saving…" : "Save Edits"}
        </Button>
      </div>
    </div>
  );
}

// ── Import dialog ──────────────────────────────────────────────────────────────

function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (list: ProspectList) => void;
}) {
  const [state, setState] = useState<ImportState>({
    step: "upload",
    listName: "",
    csvText: "",
    headers: [],
    rows: [],
    totalRows: 0,
    preview: [],
    mapping: {},
  });
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setState({
      step: "upload",
      listName: "",
      csvText: "",
      headers: [],
      rows: [],
      totalRows: 0,
      preview: [],
      mapping: {},
    });
    setError("");
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setState((s) => ({ ...s, csvText: (e.target?.result as string) ?? "" }));
    };
    reader.readAsText(file);
  };

  const handleParse = async () => {
    if (!state.csvText.trim()) {
      setError("Please select a CSV file first.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: state.csvText, listName: state.listName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Parse failed");
      } else {
        setState((s) => ({
          ...s,
          step: "mapping",
          headers: data.headers,
          rows: data.rows,
          totalRows: data.totalRows,
          preview: data.preview,
          mapping: data.suggested,
        }));
      }
    } catch {
      setError("Network error — try again.");
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/outreach/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listName: state.listName || "Imported List",
          rows: state.rows,
          mapping: state.mapping,
          csvText: state.csvText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
      } else {
        onImported(data as ProspectList);
        onClose();
        reset();
      }
    } catch {
      setError("Network error — try again.");
    }
    setImporting(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="glass-strong border-white/[0.08] rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 mb-4">
          {["Upload", "Map columns", "Confirm"].map((label, i) => {
            const stepKeys = ["upload", "mapping", "confirm"] as const;
            const active = state.step === stepKeys[i];
            const done =
              (state.step === "mapping" && i === 0) ||
              (state.step === "confirm" && i <= 1);
            return (
              <span key={label} className="flex items-center gap-2">
                <span
                  className={`${
                    active
                      ? "text-foreground font-medium"
                      : done
                      ? "text-green-400"
                      : ""
                  }`}
                >
                  {done ? "✓ " : ""}{label}
                </span>
                {i < 2 && <ChevronRight className="h-3 w-3" />}
              </span>
            );
          })}
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400 flex items-center gap-2 mb-4">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Upload */}
        {state.step === "upload" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">List Name</Label>
              <Input
                value={state.listName}
                onChange={(e) => setState((s) => ({ ...s, listName: e.target.value }))}
                placeholder="e.g. Mumbai SaaS founders — June"
                className="rounded-xl glass border-white/[0.08] h-10"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">CSV File</Label>
              <div
                onClick={() => fileRef.current?.click()}
                className="glass rounded-xl border-2 border-dashed border-white/[0.12] hover:border-purple-500/40 transition-all cursor-pointer flex flex-col items-center justify-center gap-3 py-12"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05] border border-white/[0.08]">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">
                    {state.csvText ? "File loaded ✓" : "Click to select a CSV"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Supports LinkedIn Scraper exports and any CSV with named columns
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </div>
            </div>

            <Button
              onClick={handleParse}
              disabled={uploading || !state.csvText}
              className="w-full rounded-xl h-10 border-0 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {uploading ? "Parsing…" : "Parse CSV"}
            </Button>
          </div>
        )}

        {/* Step 2: Column mapping */}
        {state.step === "mapping" && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              {state.totalRows} rows found. Map CSV columns to prospect fields:
            </p>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {state.headers.map((h) => (
                <div key={h} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-foreground/80 truncate">{h}</p>
                    {state.preview[0]?.[h] && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        e.g. {state.preview[0][h]}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <Select
                    value={state.mapping[h] ?? "skip"}
                    onValueChange={(v) =>
                      setState((s) => ({
                        ...s,
                        mapping: { ...s.mapping, [h]: v },
                      }))
                    }
                  >
                    <SelectTrigger className="w-44 rounded-xl glass border-white/[0.08] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-strong rounded-xl border-white/[0.08]">
                      {PROSPECT_FIELDS.map((f) => (
                        <SelectItem key={f} value={f} className="rounded-lg cursor-pointer text-xs">
                          {FIELD_LABELS[f] ?? f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleConfirm}
                disabled={importing}
                className="flex-1 rounded-xl h-10 border-0 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {importing ? "Importing…" : `Import ${state.totalRows} rows`}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setState((s) => ({ ...s, step: "upload" }))}
                className="rounded-xl h-10 glass border-white/[0.08]"
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProspectsPage() {
  const [listMetas, setListMetas] = useState<ListMeta[]>([]);
  const [activeListId, setActiveListId] = useState<string>("");
  const [activeList, setActiveList] = useState<ProspectList | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Prospect["draftStatus"] | "all">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftingIds, setDraftingIds] = useState<Set<string>>(new Set());
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);
  const [panelProspect, setPanelProspect] = useState<Prospect | null>(null);
  const [charLimit, setCharLimit] = useState(200);
  const [deletingListId, setDeletingListId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Autosave debounce refs: prospectId → timeout
  const notesTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const loadMetas = async () => {
    const res = await fetch("/api/outreach/lists");
    if (res.ok) {
      const metas: ListMeta[] = await res.json();
      setListMetas(metas);
      if (metas.length && !activeListId) setActiveListId(metas[0].id);
    }
  };

  const loadActiveList = async (id: string) => {
    if (!id) return;
    setLoadingList(true);
    const res = await fetch(`/api/outreach/lists/${id}`);
    if (res.ok) setActiveList(await res.json());
    setLoadingList(false);
  };

  useEffect(() => { loadMetas(); }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => { if (s.linkedinCharLimit) setCharLimit(s.linkedinCharLimit); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeListId) loadActiveList(activeListId);
  }, [activeListId]);

  const updateProspectLocally = useCallback(
    (prospectId: string, updates: Partial<Prospect>) => {
      setActiveList((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          prospects: prev.prospects.map((p) =>
            p.id === prospectId ? { ...p, ...updates } : p
          ),
        };
      });
      if (panelProspect?.id === prospectId) {
        setPanelProspect((prev) => (prev ? { ...prev, ...updates } : prev));
      }
    },
    [panelProspect]
  );

  const saveNotes = useCallback(
    (prospectId: string, notes: string) => {
      fetch("/api/outreach/lists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId: activeListId,
          prospectId,
          updates: { customNotes: notes },
        }),
      }).catch(() => {});
    },
    [activeListId]
  );

  const handleNotesChange = (prospectId: string, notes: string) => {
    updateProspectLocally(prospectId, { customNotes: notes });
    clearTimeout(notesTimers.current[prospectId]);
    notesTimers.current[prospectId] = setTimeout(() => saveNotes(prospectId, notes), 800);
  };

  const draftProspects = async (prospects: Prospect[]) => {
    if (!prospects.length || !activeListId) return;
    const ids = prospects.map((p) => p.id);
    setDraftingIds((prev) => new Set([...prev, ...ids]));
    prospects.forEach((p) => updateProspectLocally(p.id, { draftStatus: "drafting" }));

    setBatchTotal(prospects.length);
    setBatchDone(0);

    const CHUNK = 3;
    for (let i = 0; i < prospects.length; i += CHUNK) {
      const chunk = prospects.slice(i, i + CHUNK);
      try {
        const res = await fetch("/api/outreach/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prospects: chunk, listId: activeListId }),
        });
        const data = await res.json();
        if (res.ok && data.results) {
          for (const r of data.results as Array<{
            id: string;
            linkedinMessage?: string;
            emailMessage?: string;
            error?: string;
          }>) {
            if (r.error) {
              updateProspectLocally(r.id, { draftStatus: "error" });
            } else {
              updateProspectLocally(r.id, {
                linkedinMessage: r.linkedinMessage,
                emailMessage: r.emailMessage,
                draftStatus: "done",
                lastDraftedAt: new Date().toISOString(),
              });
              if (panelProspect?.id === r.id) {
                setPanelProspect((prev) =>
                  prev
                    ? {
                        ...prev,
                        linkedinMessage: r.linkedinMessage,
                        emailMessage: r.emailMessage,
                        draftStatus: "done",
                      }
                    : prev
                );
              }
            }
          }
        } else {
          chunk.forEach((p) => updateProspectLocally(p.id, { draftStatus: "error" }));
        }
      } catch {
        chunk.forEach((p) => updateProspectLocally(p.id, { draftStatus: "error" }));
      }
      setBatchDone((d) => d + chunk.length);
    }

    setDraftingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setBatchTotal(0);
    setBatchDone(0);
    setSelectedIds(new Set());
  };

  const handleDeleteList = async (id: string) => {
    setDeletingListId(id);
    await fetch(`/api/outreach/lists?id=${id}`, { method: "DELETE" });
    setDeletingListId(null);
    setActiveList(null);
    setActiveListId("");
    await loadMetas();
  };

  const filteredProspects = (activeList?.prospects ?? []).filter((p) => {
    if (statusFilter !== "all" && p.draftStatus !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        p.fullName?.toLowerCase().includes(s) ||
        p.company?.toLowerCase().includes(s) ||
        p.headline?.toLowerCase().includes(s) ||
        false
      );
    }
    return true;
  });

  const allSelected =
    filteredProspects.length > 0 &&
    filteredProspects.every((p) => selectedIds.has(p.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProspects.map((p) => p.id)));
    }
  };

  // ── Empty state ──
  if (!loadingList && listMetas.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Prospects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Import a CSV of prospects and draft personalised LinkedIn DMs and cold emails
          </p>
        </div>
        <div className="glass rounded-2xl flex-1 flex flex-col items-center justify-center gap-5 py-24">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20">
            <Mail className="h-7 w-7 text-purple-400" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-lg">No prospect lists yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Import a LinkedIn CSV export to get started. Each row becomes a prospect you can draft messages for.
            </p>
          </div>
          <Button
            onClick={() => setImportOpen(true)}
            className="rounded-xl h-11 border-0 px-6 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
        </div>

        <ImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={async (list) => {
            await loadMetas();
            setActiveListId(list.id);
            setActiveList(list);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prospects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeList?.prospects.length ?? 0} prospects
            {activeList && ` · ${activeList.name}`}
          </p>
        </div>
        <Button
          onClick={() => setImportOpen(true)}
          className="rounded-xl h-10 border-0 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
        >
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
      </div>

      {/* List selector + filters */}
      <div className="flex flex-wrap items-center gap-3">
        {listMetas.length > 1 && (
          <Select value={activeListId} onValueChange={setActiveListId}>
            <SelectTrigger className="w-64 rounded-xl glass border-white/[0.08] h-9 text-sm">
              <SelectValue placeholder="Select list" />
            </SelectTrigger>
            <SelectContent className="glass-strong rounded-xl border-white/[0.08]">
              {listMetas.map((m) => (
                <SelectItem key={m.id} value={m.id} className="rounded-lg cursor-pointer">
                  {m.name} ({m.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / company…"
            className="pl-9 rounded-xl glass border-white/[0.08] h-9 text-sm w-56"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="w-36 rounded-xl glass border-white/[0.08] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="glass-strong rounded-xl border-white/[0.08]">
            <SelectItem value="all" className="rounded-lg cursor-pointer">All statuses</SelectItem>
            <SelectItem value="idle" className="rounded-lg cursor-pointer">Idle</SelectItem>
            <SelectItem value="done" className="rounded-lg cursor-pointer">Done</SelectItem>
            <SelectItem value="error" className="rounded-lg cursor-pointer">Error</SelectItem>
          </SelectContent>
        </Select>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            {batchTotal > 0 && (
              <span className="text-[11px] text-muted-foreground">
                Drafting {batchDone} / {batchTotal}…
              </span>
            )}
            <Button
              onClick={() => {
                const toDraft = filteredProspects.filter(
                  (p) => selectedIds.has(p.id) && p.draftStatus !== "drafting"
                );
                draftProspects(toDraft);
              }}
              disabled={draftingIds.size > 0}
              className="rounded-xl h-9 border-0 text-sm bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Draft selected ({selectedIds.size})
            </Button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        )}

        {activeListId && selectedIds.size === 0 && (
          <button
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deletingListId === activeListId}
            className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-red-400 transition-colors"
          >
            {deletingListId === activeListId ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Delete list
          </button>
        )}
      </div>

      {/* Table */}
      {loadingList ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="glass rounded-2xl">
          <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] rounded-2xl">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="sticky top-0 bg-black/40 backdrop-blur-xl z-10">
                <tr className="border-b border-white/[0.06]">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Name</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Headline</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Company</th>
                  <th className="w-10 px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Link</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider min-w-[180px]">Notes</th>
                  <th className="w-24 px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Draft</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider min-w-[140px]">LinkedIn</th>
                  <th className="text-left px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider min-w-[140px]">Email</th>
                  <th className="px-3 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredProspects.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-20 text-center text-sm text-muted-foreground">
                      No prospects match your filters
                    </td>
                  </tr>
                ) : (
                  filteredProspects.map((p) => (
                    <ProspectRow
                      key={p.id}
                      prospect={p}
                      listId={activeListId}
                      charLimit={charLimit}
                      selected={selectedIds.has(p.id)}
                      onToggleSelect={() =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                          return next;
                        })
                      }
                      drafting={draftingIds.has(p.id)}
                      onDraft={() => draftProspects([p])}
                      onNotesChange={(notes) => handleNotesChange(p.id, notes)}
                      onOpenPanel={() => setPanelProspect(p)}
                      onUpdated={(updates) => updateProspectLocally(p.id, updates)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Side panel */}
      {panelProspect && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setPanelProspect(null)}
          />
          <SidePanel
            prospect={panelProspect}
            listId={activeListId}
            charLimit={charLimit}
            onClose={() => setPanelProspect(null)}
            onUpdated={(updates) => updateProspectLocally(panelProspect.id, updates)}
          />
        </>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={async (list) => {
          await loadMetas();
          setActiveListId(list.id);
          setActiveList(list);
        }}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="glass-strong border-white/[0.08] rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this list?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground">{activeList?.name}</span>{" "}
            and all {activeList?.prospects.length ?? 0} prospects will be permanently deleted.
            This cannot be undone.
          </p>
          <div className="flex gap-3 mt-4">
            <Button
              onClick={() => {
                setDeleteConfirmOpen(false);
                handleDeleteList(activeListId);
              }}
              className="flex-1 rounded-xl h-10 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirmOpen(false)}
              className="flex-1 rounded-xl h-10 glass border-white/[0.08]"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Prospect row ───────────────────────────────────────────────────────────────

function ProspectRow({
  prospect,
  selected,
  drafting,
  charLimit,
  onToggleSelect,
  onDraft,
  onNotesChange,
  onOpenPanel,
  onUpdated,
}: {
  prospect: Prospect;
  listId: string;
  charLimit: number;
  selected: boolean;
  drafting: boolean;
  onToggleSelect: () => void;
  onDraft: () => void;
  onNotesChange: (notes: string) => void;
  onOpenPanel: () => void;
  onUpdated: (u: Partial<Prospect>) => void;
}) {
  const [notes, setNotes] = useState(prospect.customNotes ?? "");

  useEffect(() => {
    setNotes(prospect.customNotes ?? "");
  }, [prospect.customNotes]);

  const liPreview = prospect.linkedinMessage
    ? prospect.linkedinMessage.slice(0, 60) + (prospect.linkedinMessage.length > 60 ? "…" : "")
    : null;
  const emailPreview = prospect.emailMessage
    ? prospect.emailMessage.slice(0, 60) + (prospect.emailMessage.length > 60 ? "…" : "")
    : null;
  const liOver = prospect.linkedinMessage && prospect.linkedinMessage.length > charLimit;

  return (
    <tr
      className={`border-b border-white/[0.04] transition-colors ${
        selected ? "bg-purple-500/5" : "hover:bg-white/[0.02]"
      }`}
    >
      {/* Checkbox */}
      <td className="px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="rounded"
        />
      </td>

      {/* Name */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <p className="text-[13px] font-medium">{prospect.fullName || "—"}</p>
        {prospect.email && (
          <p className="text-[10px] text-muted-foreground">{prospect.email}</p>
        )}
      </td>

      {/* Headline */}
      <td className="px-3 py-2.5 max-w-[180px]">
        <p className="text-[12px] text-muted-foreground truncate">{prospect.headline || "—"}</p>
      </td>

      {/* Company */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <p className="text-[12px]">{prospect.company || "—"}</p>
      </td>

      {/* Profile link */}
      <td className="px-3 py-2.5 text-center">
        {prospect.profileUrl ? (
          <a
            href={prospect.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-all mx-auto"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="text-muted-foreground/30">—</span>
        )}
      </td>

      {/* Notes */}
      <td className="px-3 py-2.5 min-w-[180px]">
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            onNotesChange(e.target.value);
          }}
          rows={2}
          placeholder="Add context…"
          className="w-full text-[12px] bg-transparent border border-transparent hover:border-white/[0.08] focus:border-white/[0.15] rounded-lg px-2 py-1.5 resize-none outline-none transition-all placeholder:text-muted-foreground/40"
        />
      </td>

      {/* Draft button */}
      <td className="px-3 py-2.5 text-center">
        <button
          onClick={onDraft}
          disabled={drafting}
          className="flex items-center gap-1.5 rounded-xl h-8 px-3 text-[11px] font-medium border-0 bg-gradient-to-r from-purple-500/80 to-indigo-600/80 hover:from-purple-500 hover:to-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all mx-auto"
        >
          {drafting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Draft
        </button>
        {prospect.draftStatus === "error" && (
          <button
            onClick={onDraft}
            disabled={drafting}
            className="mt-1 text-[10px] text-red-400 hover:text-red-300 transition-colors"
          >
            Retry
          </button>
        )}
      </td>

      {/* LinkedIn message */}
      <td className="px-3 py-2.5 min-w-[140px]">
        {liPreview ? (
          <div className="flex items-start gap-1.5">
            <button
              onClick={onOpenPanel}
              className={`text-[11px] text-left flex-1 leading-relaxed hover:text-foreground transition-colors ${
                liOver ? "text-red-400" : "text-muted-foreground"
              }`}
            >
              {liPreview}
            </button>
            <CopyButton text={prospect.linkedinMessage!} />
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">—</span>
        )}
      </td>

      {/* Email */}
      <td className="px-3 py-2.5 min-w-[140px]">
        {emailPreview ? (
          <div className="flex items-start gap-1.5">
            <button
              onClick={onOpenPanel}
              className="text-[11px] text-muted-foreground text-left flex-1 leading-relaxed hover:text-foreground transition-colors"
            >
              {emailPreview}
            </button>
            <CopyButton text={prospect.emailMessage!} />
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5 text-center">
        <StatusBadge status={prospect.draftStatus} />
      </td>
    </tr>
  );
}
