"use client";

import { ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY_LEVELS, LEVEL_META, LEAD_STATUS_ORDER, LEAD_STATUS_LABELS, WEBSITE_STATUS_LABELS } from "@/lib/lead-scoring";
import type { LeadFilters } from "@/hooks/use-lead-filters";
import type { PriorityLevel, LeadStatus, WebsiteStatus } from "@/lib/types";

const WEBSITE_OPTIONS: WebsiteStatus[] = ["no_website", "has_website", "social_only"];

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function FilterBar({
  filters,
  setFilters,
  categories,
  locations,
  resultCount,
  active,
  onClear,
}: {
  filters: LeadFilters;
  setFilters: (next: LeadFilters | ((f: LeadFilters) => LeadFilters)) => void;
  categories: string[];
  locations: string[];
  resultCount: number;
  active: boolean;
  onClear: () => void;
}) {
  const patch = (p: Partial<LeadFilters>) => setFilters((f) => ({ ...f, ...p }));

  const activeChips: { key: string; label: string; clear: () => void }[] = [
    ...filters.priority.map((p) => ({ key: `pr-${p}`, label: LEVEL_META[p].label, clear: () => patch({ priority: filters.priority.filter((x) => x !== p) }) })),
    ...filters.website.map((w) => ({ key: `web-${w}`, label: WEBSITE_STATUS_LABELS[w], clear: () => patch({ website: filters.website.filter((x) => x !== w) }) })),
    ...filters.status.map((s) => ({ key: `st-${s}`, label: LEAD_STATUS_LABELS[s], clear: () => patch({ status: filters.status.filter((x) => x !== s) }) })),
    ...(filters.hasEmail ? [{ key: "email", label: "Has Email", clear: () => patch({ hasEmail: false }) }] : []),
    ...(filters.hasPhone ? [{ key: "phone", label: "Has Phone", clear: () => patch({ hasPhone: false }) }] : []),
    ...(filters.category ? [{ key: "cat", label: filters.category, clear: () => patch({ category: "" }) }] : []),
    ...(filters.location ? [{ key: "loc", label: filters.location, clear: () => patch({ location: "" }) }] : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <ListFilter className="size-4" />
            Filters
            {active && <Badge variant="secondary" className="ml-1 px-1.5">{activeChips.length}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-4">
          {/* Priority */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priority</p>
            <div className="grid grid-cols-2 gap-1.5">
              {PRIORITY_LEVELS.map((lvl: PriorityLevel) => (
                <Label key={lvl} className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox checked={filters.priority.includes(lvl)} onCheckedChange={() => patch({ priority: toggle(filters.priority, lvl) })} />
                  {LEVEL_META[lvl].label}
                </Label>
              ))}
            </div>
          </div>
          <Separator />
          {/* Website */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Website</p>
            <div className="space-y-1.5">
              {WEBSITE_OPTIONS.map((w) => (
                <Label key={w} className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox checked={filters.website.includes(w)} onCheckedChange={() => patch({ website: toggle(filters.website, w) })} />
                  {WEBSITE_STATUS_LABELS[w]}
                </Label>
              ))}
            </div>
          </div>
          <Separator />
          {/* Contact */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</p>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={filters.hasEmail} onCheckedChange={(v) => patch({ hasEmail: !!v })} />
              Has Email
            </Label>
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={filters.hasPhone} onCheckedChange={(v) => patch({ hasPhone: !!v })} />
              Has Phone
            </Label>
          </div>
          <Separator />
          {/* Status */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
            <div className="grid grid-cols-2 gap-1.5">
              {LEAD_STATUS_ORDER.map((s: LeadStatus) => (
                <Label key={s} className="flex items-center gap-2 text-sm font-normal">
                  <Checkbox checked={filters.status.includes(s)} onCheckedChange={() => patch({ status: toggle(filters.status, s) })} />
                  {LEAD_STATUS_LABELS[s]}
                </Label>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Category */}
      {categories.length > 0 && (
        <Select value={filters.category || "all"} onValueChange={(v) => patch({ category: v === "all" ? "" : v })}>
          <SelectTrigger size="sm" className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {/* Location */}
      {locations.length > 0 && (
        <Select value={filters.location || "all"} onValueChange={(v) => patch({ location: v === "all" ? "" : v })}>
          <SelectTrigger size="sm" className="w-40"><SelectValue placeholder="Location" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <span className="text-sm text-muted-foreground">{resultCount} {resultCount === 1 ? "lead" : "leads"}</span>

      {active && (
        <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
      )}

      {/* Active chips */}
      {activeChips.length > 0 && (
        <div className="flex w-full flex-wrap gap-1.5">
          {activeChips.map((chip) => (
            <Badge key={chip.key} variant="secondary" className="gap-1 pr-1">
              {chip.label}
              <button onClick={chip.clear} className="rounded-full hover:bg-muted-foreground/20"><X className="size-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
