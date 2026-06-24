"use client";

import { Globe, GlobeLock, Share2, MoreHorizontal, ExternalLink, Copy, Sparkles, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TableCell, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PriorityBadge } from "./priority-badge";
import { LeadStatusSelect } from "./lead-status-select";
import { WEBSITE_STATUS_LABELS } from "@/lib/lead-scoring";
import type { Prospect } from "@/lib/types";

function monogram(p: Prospect): string {
  const src = p.company || p.fullName || "?";
  return src.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function WebsiteDot({ status }: { status?: Prospect["websiteStatus"] }) {
  const Icon = status === "no_website" ? GlobeLock : status === "social_only" ? Share2 : Globe;
  const color =
    status === "no_website" ? "text-amber-500" : status === "has_website" ? "text-emerald-500" : "text-muted-foreground";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex"><Icon className={`size-4 ${color}`} /></span>
      </TooltipTrigger>
      <TooltipContent>{WEBSITE_STATUS_LABELS[status ?? "unknown"]}</TooltipContent>
    </Tooltip>
  );
}

// Inline-editable price cell. Uncontrolled (keyed to the external value) so typing
// never triggers a parent re-render; persists on blur only when the value changed.
function PriceCell({ value, onCommit }: { value?: number; onCommit: (v: number | undefined) => void }) {
  return (
    <Input
      key={value ?? ""}
      type="number"
      defaultValue={value ?? ""}
      placeholder="—"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const next = raw === "" ? undefined : Number(raw);
        if (next !== value && !(next === undefined && value === undefined)) onCommit(next);
      }}
      className="h-8 w-24 text-sm tabular-nums"
    />
  );
}

function NoteCell({ value, onCommit }: { value?: string; onCommit: (v: string) => void }) {
  return (
    <Input
      key={value ?? ""}
      defaultValue={value ?? ""}
      placeholder="Add note / objection…"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const next = e.target.value;
        if (next !== (value ?? "")) onCommit(next);
      }}
      className="h-8 w-48 text-sm"
    />
  );
}

export function LeadRow({
  prospect,
  analyzing,
  selected,
  onToggleSelect,
  onOpen,
  onStatusChange,
  onEditField,
  onRegenerate,
  onDelete,
}: {
  prospect: Prospect;
  analyzing?: boolean;
  selected?: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onStatusChange: (status: Prospect["leadStatus"]) => void;
  onEditField: (updates: Partial<Prospect>) => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const copy = (text: string | undefined, label: string) => {
    if (!text) return toast.error(`No ${label} to copy`);
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <TableRow className="cursor-pointer" data-state={selected ? "selected" : undefined} onClick={onOpen}>
      {/* Select */}
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={!!selected} onCheckedChange={onToggleSelect} aria-label="Select lead" />
      </TableCell>

      {/* Business */}
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            <AvatarFallback>{monogram(prospect)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{prospect.company || prospect.fullName || "—"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {prospect.businessCategory || prospect.headline || "—"}
              {prospect.location ? ` · ${prospect.location}` : ""}
            </p>
          </div>
        </div>
      </TableCell>

      {/* Priority */}
      <TableCell>
        {analyzing ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />Analyzing</span>
        ) : (
          <PriorityBadge score={prospect.priorityScore} level={prospect.priorityLevel} />
        )}
      </TableCell>

      {/* Rating / reviews */}
      <TableCell className="text-sm tabular-nums text-muted-foreground">
        {prospect.rating != null ? `${prospect.rating}★` : "—"}
        {prospect.reviewCount != null ? ` (${prospect.reviewCount})` : ""}
      </TableCell>

      {/* Website */}
      <TableCell><WebsiteDot status={prospect.websiteStatus} /></TableCell>

      {/* Status */}
      <TableCell onClick={(e) => e.stopPropagation()}>
        <LeadStatusSelect value={prospect.leadStatus} onChange={onStatusChange} />
      </TableCell>

      {/* Last contacted */}
      <TableCell className="text-xs text-muted-foreground">{fmtDate(prospect.lastContactedAt)}</TableCell>

      {/* Follow up */}
      <TableCell className="text-xs text-muted-foreground">{fmtDate(prospect.followUpDate)}</TableCell>

      {/* Price quoted */}
      <TableCell>
        <PriceCell value={prospect.priceQuoted} onCommit={(v) => onEditField({ priceQuoted: v })} />
      </TableCell>

      {/* Price confirmed */}
      <TableCell>
        <PriceCell value={prospect.priceConfirmed} onCommit={(v) => onEditField({ priceConfirmed: v })} />
      </TableCell>

      {/* Note / objection */}
      <TableCell>
        <NoteCell value={prospect.customNotes} onCommit={(v) => onEditField({ customNotes: v })} />
      </TableCell>

      {/* Actions */}
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm"><MoreHorizontal className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}><ExternalLink className="size-3.5" />Open</DropdownMenuItem>
            <DropdownMenuItem onClick={onRegenerate}><Sparkles className="size-3.5" />Regenerate</DropdownMenuItem>
            <DropdownMenuItem onClick={() => copy(prospect.whatsappMessage, "WhatsApp message")}><Copy className="size-3.5" />Copy WhatsApp</DropdownMenuItem>
            <DropdownMenuItem onClick={() => copy(prospect.emailMessage, "Email")}><Copy className="size-3.5" />Copy Email</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 className="size-3.5" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
