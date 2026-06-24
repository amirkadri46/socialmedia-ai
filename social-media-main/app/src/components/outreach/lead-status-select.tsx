"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_STATUS_ORDER, LEAD_STATUS_LABELS, STATUS_META } from "@/lib/lead-scoring";
import type { LeadStatus } from "@/lib/types";

export function LeadStatusSelect({
  value,
  onChange,
  className,
}: {
  value?: LeadStatus;
  onChange: (next: LeadStatus) => void;
  className?: string;
}) {
  const current = value ?? "new";
  return (
    <Select value={current} onValueChange={(v) => onChange(v as LeadStatus)}>
      <SelectTrigger size="sm" className={className ?? "h-8 w-[150px] text-xs"}>
        <span className="flex items-center gap-2 truncate">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: STATUS_META[current].color }}
          />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {LEAD_STATUS_ORDER.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: STATUS_META[s].color }} />
              {LEAD_STATUS_LABELS[s]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
