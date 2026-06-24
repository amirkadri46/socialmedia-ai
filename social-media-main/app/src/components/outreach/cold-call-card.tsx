import { Star, MessageSquare, ThumbsUp, ThumbsDown, Phone } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { ColdCallNotes } from "@/lib/types";

export function ColdCallCard({ notes }: { notes?: ColdCallNotes }) {
  if (!notes) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No cold-call brief yet. Run Analyze to generate one.
      </p>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={Phone} label="Type" value={notes.businessType || "—"} />
        <Stat icon={Star} label="Rating" value={notes.rating ? `${notes.rating} / 5` : "—"} />
        <Stat icon={MessageSquare} label="Reviews" value={notes.reviewCount?.toString() || "—"} />
      </div>
      <Separator />
      <div className="space-y-3">
        <div className="flex gap-2">
          <ThumbsUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Key strength</p>
            <p>{notes.keyStrength || "—"}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <ThumbsDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Key weakness / opportunity</p>
            <p>{notes.keyWeakness || "—"}</p>
          </div>
        </div>
      </div>
      <Separator />
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Talking points</p>
        <ul className="list-disc space-y-1 pl-5">
          {(notes.talkingPoints ?? []).map((tp, i) => (
            <li key={i}>{tp}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3" />
        <span className="text-[11px]">{label}</span>
      </div>
      <p className="mt-0.5 truncate font-medium">{value}</p>
    </div>
  );
}
