import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEVEL_META, PRIORITY_LEVELS, LEAD_STATUS_ORDER, LEAD_STATUS_LABELS, STATUS_META } from "@/lib/lead-scoring";
import type { PriorityLevel, LeadStatus } from "@/lib/types";

export function PriorityDistribution({ data }: { data: Record<PriorityLevel, number> }) {
  const max = Math.max(1, ...PRIORITY_LEVELS.map((l) => data[l] ?? 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Priority distribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {PRIORITY_LEVELS.map((lvl) => {
          const v = data[lvl] ?? 0;
          const meta = LEVEL_META[lvl];
          return (
            <div key={lvl} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{meta.label}</span>
                <span className="tabular-nums font-medium">{v}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-all" style={{ width: `${(v / max) * 100}%`, backgroundColor: meta.color }} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function PipelineFunnel({ data }: { data: Record<LeadStatus, number> }) {
  const max = Math.max(1, ...LEAD_STATUS_ORDER.map((s) => data[s] ?? 0));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Pipeline by status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {LEAD_STATUS_ORDER.map((s) => {
          const v = data[s] ?? 0;
          const meta = STATUS_META[s];
          return (
            <div key={s} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{LEAD_STATUS_LABELS[s]}</span>
              <div className="h-5 flex-1 overflow-hidden rounded-md bg-muted">
                <div
                  className="flex h-full items-center justify-end rounded-md px-2 text-[10px] font-medium text-white transition-all"
                  style={{ width: `${Math.max(v > 0 ? 8 : 0, (v / max) * 100)}%`, backgroundColor: meta.color }}
                >
                  {v > 0 ? v : ""}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
