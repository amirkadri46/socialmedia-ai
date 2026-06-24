"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { LeadRow } from "./lead-row";
import type { Prospect } from "@/lib/types";

type SortKey = "score" | "rating" | "reviews";
type SortDir = "asc" | "desc";

// Infinite scroll: render this many rows up front, then grow as the user scrolls.
const INITIAL_VISIBLE = 60;
const VISIBLE_STEP = 40;
const COLUMN_COUNT = 12;

function SortHead({
  k,
  label,
  sortKey,
  sortDir,
  onSort,
}: {
  k: SortKey;
  label: string;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  return (
    <button onClick={() => onSort(k)} className="flex items-center gap-1 hover:text-foreground">
      {label}
      {sortKey === k ? (
        sortDir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

export function LeadTable({
  prospects,
  loading,
  analyzingIds,
  selectedIds,
  onToggleSelect,
  onToggleSelectMany,
  onOpen,
  onStatusChange,
  onEditField,
  onRegenerate,
  onDelete,
}: {
  prospects: Prospect[];
  loading?: boolean;
  analyzingIds?: Set<string>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectMany: (ids: string[], checked: boolean) => void;
  onOpen: (p: Prospect) => void;
  onStatusChange: (p: Prospect, status: Prospect["leadStatus"]) => void;
  onEditField: (p: Prospect, updates: Partial<Prospect>) => void;
  onRegenerate: (p: Prospect) => void;
  onDelete: (p: Prospect) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey | null>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  const sorted = useMemo(() => {
    if (!sortKey) return prospects;
    const val = (p: Prospect) =>
      sortKey === "score" ? p.priorityScore ?? -1 : sortKey === "rating" ? p.rating ?? -1 : p.reviewCount ?? -1;
    return [...prospects].sort((a, b) => (sortDir === "desc" ? val(b) - val(a) : val(a) - val(b)));
  }, [prospects, sortKey, sortDir]);

  // Reset the window when the result set size or sort changes — but NOT on an inline
  // field edit (which mutates a prospect in place without changing the row count),
  // so the scroll position and loaded rows survive editing price/note cells. Done as a
  // render-time reset (React's documented "adjust state when a prop changes" pattern)
  // rather than an effect, to avoid a cascading second render.
  const resetKey = `${sorted.length}|${sortKey}|${sortDir}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setVisibleCount(INITIAL_VISIBLE);
  }

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  // Grow the window when the sentinel scrolls into view (root = the ScrollArea viewport).
  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    const viewport = rootRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(c + VISIBLE_STEP, sorted.length));
        }
      },
      { root: viewport ?? null, rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, sorted.length, visibleCount]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const selectedInView = sorted.filter((p) => selectedIds.has(p.id)).length;
  const allChecked: boolean | "indeterminate" =
    sorted.length > 0 && selectedInView === sorted.length
      ? true
      : selectedInView > 0
        ? "indeterminate"
        : false;

  if (loading) {
    return (
      <div className="space-y-2 rounded-xl border p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (prospects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border py-20 text-center">
        <p className="text-sm font-medium">No leads match your filters</p>
        <p className="text-sm text-muted-foreground">Adjust the filters or import a Google Maps CSV.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border" ref={rootRef}>
      <ScrollArea className="max-h-[calc(100vh-22rem)]">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(v) => onToggleSelectMany(sorted.map((p) => p.id), v === true)}
                  aria-label="Select all leads"
                />
              </TableHead>
              <TableHead>Business</TableHead>
              <TableHead><SortHead k="score" label="Priority" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></TableHead>
              <TableHead><SortHead k="rating" label="Rating" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contacted</TableHead>
              <TableHead>Follow-up</TableHead>
              <TableHead>Price quoted</TableHead>
              <TableHead>Price confirmed</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => (
              <LeadRow
                key={p.id}
                prospect={p}
                analyzing={analyzingIds?.has(p.id)}
                selected={selectedIds.has(p.id)}
                onToggleSelect={() => onToggleSelect(p.id)}
                onOpen={() => onOpen(p)}
                onStatusChange={(s) => onStatusChange(p, s)}
                onEditField={(updates) => onEditField(p, updates)}
                onRegenerate={() => onRegenerate(p)}
                onDelete={() => onDelete(p)}
              />
            ))}
            {hasMore && (
              <TableRow ref={sentinelRef} className="hover:bg-transparent">
                <TableCell colSpan={COLUMN_COUNT} className="py-6 text-center text-xs text-muted-foreground">
                  Loading more…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
        <span>
          Showing {visible.length} of {sorted.length}
        </span>
        {selectedInView > 0 && <span>{selectedInView} selected</span>}
      </div>
    </div>
  );
}
