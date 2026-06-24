"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

export interface AnalyzeState {
  running: boolean;
  phase: "idle" | "analyzing" | "generating" | "done" | "error";
  analyzed: number;
  generated: number;
  total: number;
  error?: string;
}

function Line({
  label,
  value,
  total,
  active,
  complete,
}: {
  label: string;
  value: number;
  total: number;
  active: boolean;
  complete: boolean;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          {complete ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : active ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <span className="size-4" />
          )}
          {label} {value}/{total}
        </span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

export function AnalyzeProgressDialog({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AnalyzeState;
}) {
  const done = state.phase === "done";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{done ? "Analysis complete" : "Analyzing leads"}</DialogTitle>
          <DialogDescription>
            {done
              ? "All selected leads have been scored and have outreach drafts."
              : "You can close this window — processing continues in the background."}
          </DialogDescription>
        </DialogHeader>

        {state.phase === "error" ? (
          <p className="text-sm text-destructive">{state.error || "Analysis failed."}</p>
        ) : (
          <div className="space-y-4 py-2">
            <Line
              label="Analyzing"
              value={state.analyzed}
              total={state.total}
              active={state.phase === "analyzing"}
              complete={state.analyzed >= state.total && state.total > 0}
            />
            <Line
              label="Generating Messages"
              value={state.generated}
              total={state.total}
              active={state.phase === "generating"}
              complete={done && state.total > 0}
            />
            {done && <p className="text-center text-sm font-medium text-emerald-500">Completed</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
