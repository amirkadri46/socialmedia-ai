"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload, Sparkles, Search, Trash2, Users, Loader2, MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLeads } from "@/hooks/use-leads";
import { useLeadFilters } from "@/hooks/use-lead-filters";
import { FilterBar } from "@/components/outreach/filter-bar";
import { LeadTable } from "@/components/outreach/lead-table";
import { LeadDetailSheet } from "@/components/outreach/lead-detail-sheet";
import { ImportWizard } from "@/components/outreach/import-wizard";
import {
  AnalyzeProgressDialog,
  type AnalyzeState,
} from "@/components/outreach/analyze-progress-dialog";
import type { Prospect } from "@/lib/types";

const IDLE_ANALYZE: AnalyzeState = { running: false, phase: "idle", analyzed: 0, generated: 0, total: 0 };

export default function LeadsPage() {
  const {
    listMetas,
    activeListId,
    setActiveListId,
    activeList,
    loadingList,
    loadMetas,
    setActiveList,
    patchLocal,
    updateProspect,
    deleteProspect,
    deleteList,
  } = useLeads();

  const prospects = useMemo(() => activeList?.prospects ?? [], [activeList]);
  const { filters, setFilters, filtered, categories, locations, active, clear } = useLeadFilters(activeListId, prospects);

  const [whatsappLimit, setWhatsappLimit] = useState(600);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzeState, setAnalyzeState] = useState<AnalyzeState>(IDLE_ANALYZE);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [deleteListOpen, setDeleteListOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => { if (s.whatsappCharLimit) setWhatsappLimit(s.whatsappCharLimit); })
      .catch(() => {});
  }, []);

  const selected = useMemo(
    () => (selectedId ? prospects.find((p) => p.id === selectedId) ?? null : null),
    [selectedId, prospects]
  );

  const openLead = (p: Prospect) => { setSelectedId(p.id); setSheetOpen(true); };

  // ── Selection (bulk actions) ──
  // Clear selection whenever the active list changes.
  useEffect(() => { setSelectedIds(new Set()); }, [activeListId]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectMany = useCallback((ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Analyze (SSE) — runs in the page so closing the dialog doesn't cancel it ──
  const runAnalyze = useCallback(
    async (ids: string[] | undefined, opts?: { silent?: boolean; regenerate?: boolean; messagesOnly?: boolean }) => {
      if (!activeListId) return;
      const targetIds = ids ?? prospects.map((p) => p.id);
      if (targetIds.length === 0) return;
      const idSet = new Set(targetIds);
      setAnalyzingIds((prev) => new Set([...prev, ...targetIds]));
      if (opts?.silent) setRegeneratingId(targetIds[0]);
      else {
        setAnalyzeState({
          running: true,
          phase: opts?.messagesOnly ? "generating" : "analyzing",
          analyzed: opts?.messagesOnly ? targetIds.length : 0,
          generated: 0,
          total: targetIds.length,
        });
        setAnalyzeOpen(true);
      }

      try {
        const res = await fetch("/api/outreach/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId: activeListId, prospectIds: ids, regenerate: opts?.regenerate, messagesOnly: opts?.messagesOnly }),
        });
        if (!res.body) throw new Error("No stream");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawError = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const evt of events) {
            const line = evt.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let data: {
              phase: string;
              completed?: number;
              total?: number;
              lead?: Prospect;
              error?: string;
            };
            try { data = JSON.parse(line.slice(5).trim()); } catch { continue; }

            if (data.lead) patchLocal(data.lead.id, data.lead);

            if (data.phase === "analyzing" && !opts?.silent) {
              setAnalyzeState((s) => ({ ...s, phase: "analyzing", analyzed: data.completed ?? s.analyzed, total: data.total ?? s.total }));
            } else if (data.phase === "generating" && !opts?.silent) {
              setAnalyzeState((s) => ({ ...s, phase: "generating", generated: data.completed ?? s.generated, total: data.total ?? s.total }));
            } else if (data.phase === "done") {
              if (!opts?.silent) setAnalyzeState((s) => ({ ...s, phase: "done", running: false, analyzed: s.total, generated: s.total }));
            } else if (data.phase === "error") {
              sawError = true;
              if (!opts?.silent) setAnalyzeState((s) => ({ ...s, phase: "error", running: false, error: data.error }));
              toast.error(data.error ?? "Analysis failed");
            }
          }
        }
        if (sawError) return;
        if (!opts?.silent) toast.success("Analysis complete");
        else toast.success("Lead regenerated");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Analysis failed";
        if (!opts?.silent) setAnalyzeState((s) => ({ ...s, phase: "error", running: false, error: msg }));
        toast.error(msg);
      } finally {
        setAnalyzingIds((prev) => {
          const next = new Set(prev);
          idSet.forEach((id) => next.delete(id));
          return next;
        });
        setRegeneratingId(null);
      }
    },
    [activeListId, prospects, patchLocal]
  );

  const handleStatusChange = (p: Prospect, status: Prospect["leadStatus"]) => {
    updateProspect(p.id, { leadStatus: status });
  };

  const handleDeleteLead = (p: Prospect) => {
    deleteProspect(p.id);
    if (selectedId === p.id) setSheetOpen(false);
    toast.success("Lead deleted");
  };

  // ── Empty state ──
  if (!loadingList && listMetas.length === 0) {
    return (
      <div className="flex h-full flex-col gap-6">
        <Header onImport={() => setImportOpen(true)} />
        <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-2xl border py-24">
          <div className="flex size-14 items-center justify-center rounded-2xl border bg-muted/40">
            <Users className="size-7 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold">No leads yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Import a Google Maps (or LinkedIn) CSV. Each row becomes a lead you can analyze, score, and reach out to.
            </p>
          </div>
          <Button onClick={() => setImportOpen(true)}><Upload className="size-4" />Import CSV</Button>
        </div>
        <ImportWizard open={importOpen} onOpenChange={setImportOpen} onImported={async (list) => { await loadMetas(); setActiveListId(list.id); setActiveList(list); }} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-5">
      <Header onImport={() => setImportOpen(true)} />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {listMetas.length > 1 && (
          <Select value={activeListId} onValueChange={setActiveListId}>
            <SelectTrigger size="sm" className="w-56"><SelectValue placeholder="Select list" /></SelectTrigger>
            <SelectContent>
              {listMetas.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.count})</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search business / category…"
            className="h-8 w-56 pl-8"
          />
        </div>
        <Button
          size="sm"
          onClick={() => runAnalyze(undefined)}
          disabled={analyzeState.running || prospects.length === 0}
        >
          {analyzeState.running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          Analyze All
        </Button>
        {activeListId && (
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setDeleteListOpen(true)}>
            <Trash2 className="size-3.5" />Delete list
          </Button>
        )}
      </div>

      <FilterBar
        filters={filters}
        setFilters={setFilters}
        categories={categories}
        locations={locations}
        resultCount={filtered.length}
        active={active}
        onClear={clear}
      />

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            size="sm"
            onClick={() => runAnalyze([...selectedIds], { regenerate: true })}
            disabled={analyzeState.running}
          >
            <Sparkles className="size-4" />Analyze
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runAnalyze([...selectedIds], { messagesOnly: true })}
            disabled={analyzeState.running}
          >
            <MessageSquarePlus className="size-4" />Create messages
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={clearSelection}>
            <X className="size-3.5" />Clear
          </Button>
        </div>
      )}

      <LeadTable
        prospects={filtered}
        loading={loadingList}
        analyzingIds={analyzingIds}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectMany={toggleSelectMany}
        onOpen={openLead}
        onStatusChange={handleStatusChange}
        onEditField={(p, updates) => updateProspect(p.id, updates)}
        onRegenerate={(p) => runAnalyze([p.id], { silent: true, regenerate: true })}
        onDelete={handleDeleteLead}
      />

      <LeadDetailSheet
        prospect={selected}
        open={sheetOpen}
        whatsappLimit={whatsappLimit}
        onOpenChange={setSheetOpen}
        onUpdate={(updates) => selected && updateProspect(selected.id, updates)}
        onRegenerate={() => selected && runAnalyze([selected.id], { silent: true, regenerate: true })}
        regenerating={!!selected && regeneratingId === selected.id}
      />

      <ImportWizard open={importOpen} onOpenChange={setImportOpen} onImported={async (list) => { await loadMetas(); setActiveListId(list.id); setActiveList(list); }} />

      <AnalyzeProgressDialog open={analyzeOpen} onOpenChange={setAnalyzeOpen} state={analyzeState} />

      <Dialog open={deleteListOpen} onOpenChange={setDeleteListOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this list?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{activeList?.name}</span> and all {prospects.length} leads will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteListOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => { setDeleteListOpen(false); await deleteList(activeListId); toast.success("List deleted"); }}
            >
              <Trash2 className="size-3.5" />Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Header({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">Import, analyze, score, and reach out — all in one workspace.</p>
      </div>
      <Button onClick={onImport}><Upload className="size-4" />Import CSV</Button>
    </div>
  );
}
