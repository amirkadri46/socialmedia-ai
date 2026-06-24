import { Badge } from "@/components/ui/badge";
import { LEVEL_META } from "@/lib/lead-scoring";
import type { PriorityLevel } from "@/lib/types";

export function PriorityBadge({
  score,
  level,
  showScore = true,
}: {
  score?: number;
  level?: PriorityLevel;
  showScore?: boolean;
}) {
  if (!level && score == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const meta = level ? LEVEL_META[level] : null;
  const color = meta?.color ?? "#6b7280";
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border font-medium"
      style={{ borderColor: `${color}66`, color, backgroundColor: `${color}1a` }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {meta?.label ?? "Unscored"}
      {showScore && score != null && <span className="tabular-nums opacity-80">{score}</span>}
    </Badge>
  );
}
