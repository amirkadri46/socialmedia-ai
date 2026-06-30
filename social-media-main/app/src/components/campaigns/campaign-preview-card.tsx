"use client";

import { useEffect, useMemo } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { calculatePreview } from "@/lib/services/schedule-service";
import type { ScheduleRule } from "@/lib/db/types";

interface Props {
  campaignId: string;
  videoCount: number;
  accountCount: number;
  scheduleRule?: ScheduleRule;
  onValidChange?: (valid: boolean) => void;
}

function fmtDateTime(iso: string, tz: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: tz, weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function fmtTime(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
  });
}

function fmtDuration(minutes: number): string {
  if (minutes === 0) return "Instantly";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

function fmtFreq(hours: number): string {
  if (hours < 1) return `Every ${Math.round(hours * 60)} min`;
  return hours === 1 ? "Every 1 hour" : `Every ${hours} hours`;
}

function fmtRandomize(minutes: number): string {
  if (minutes === 0) return "None";
  if (minutes < 1) return `±${minutes * 60} sec per account`;
  return `±${minutes} min per account`;
}

function groupByDay(slots: string[], tz: string): { label: string; times: string[] }[] {
  const groups: { label: string; times: string[] }[] = [];
  for (const iso of slots) {
    const dayLabel = new Date(iso).toLocaleDateString("en-US", {
      timeZone: tz, weekday: "short", month: "short", day: "numeric",
    });
    const last = groups.at(-1);
    if (last?.label === dayLabel) last.times.push(iso);
    else groups.push({ label: dayLabel, times: [iso] });
  }
  return groups;
}

export function CampaignPreviewCard({ campaignId, videoCount, accountCount, scheduleRule, onValidChange }: Props) {
  const preview = useMemo(
    () => scheduleRule && videoCount > 0 ? calculatePreview(videoCount, accountCount, scheduleRule) : null,
    [videoCount, accountCount, scheduleRule]
  );

  useEffect(() => {
    onValidChange?.(!preview?.validationError);
  }, [preview?.validationError, onValidChange]);

  if (!campaignId || (!videoCount && !accountCount)) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Select videos and accounts to see preview.
      </div>
    );
  }

  const tz = scheduleRule?.timezone ?? "UTC";
  const mode = scheduleRule?.mode ?? "single";

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-semibold">Campaign Preview</p>
      <div className="border-t border-border" />

      {!preview ? (
        <p className="text-sm text-muted-foreground">Configure a schedule to see preview.</p>
      ) : (
        <div className="text-sm space-y-3">
          {/* Validation */}
          {preview.validationError ? (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">{preview.validationError}</p>
            </div>
          ) : preview.validationInfo ? (
            <div className="flex items-start gap-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 p-3 text-yellow-400">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">{preview.validationInfo}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-500 text-xs">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Schedule is valid
            </div>
          )}

          {/* Counts */}
          <div className="space-y-1.5 border-t border-border pt-2">
            <Row label="Videos" value={videoCount} />
            <Row label="Accounts" value={accountCount} />
            <Row label="Posts per account" value={videoCount} />
            <Row label="Total posts" value={preview.totalJobs} />
          </div>

          {/* Timing */}
          <div className="space-y-1.5 border-t border-border pt-2">
            <Row label="Frequency" value={fmtFreq(scheduleRule!.frequencyHours)} />
            {scheduleRule!.randomizeMinutes > 0 && (
              <Row label="Randomize" value={fmtRandomize(scheduleRule!.randomizeMinutes)} />
            )}
            <Row
              label="Estimated start"
              value={mode === "now" ? "Immediately" : fmtDateTime(preview.estimatedStart, tz)}
            />
            <Row
              label="Estimated finish"
              value={mode === "now"
                ? `~${fmtDuration(preview.durationMinutes)} from now`
                : fmtDateTime(preview.estimatedFinish, tz)
              }
            />
            <Row label="Duration" value={fmtDuration(preview.durationMinutes)} />
          </div>

          {/* Slots */}
          {preview.slots.length > 0 && (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="text-xs text-muted-foreground font-medium">Publishing slots</p>
              {mode === "multi" ? (
                <MultiDaySlots slots={preview.slots} tz={tz} />
              ) : (
                <>
                  {preview.slots.slice(0, 5).map((slot, i) => (
                    <Row key={slot + i} label={`Slot ${i + 1}`} value={fmtDateTime(slot, tz)} />
                  ))}
                  {preview.slots.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      +{preview.slots.length - 5} more slot{preview.slots.length - 5 === 1 ? "" : "s"}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MultiDaySlots({ slots, tz }: { slots: string[]; tz: string }) {
  const groups = groupByDay(slots, tz);
  return (
    <div className="space-y-3">
      {groups.length > 1 && (
        <Row label="Total days" value={groups.length} />
      )}
      {groups.slice(0, 3).map((g) => (
        <div key={g.label} className="space-y-1">
          <p className="text-xs font-semibold text-foreground">{g.label}</p>
          {g.times.slice(0, 5).map((t) => (
            <div key={t} className="flex justify-end pl-3">
              <span className="text-xs font-medium">{fmtTime(t, tz)}</span>
            </div>
          ))}
          {g.times.length > 5 && (
            <p className="text-xs text-muted-foreground pl-3">+{g.times.length - 5} more</p>
          )}
        </div>
      ))}
      {groups.length > 3 && (
        <p className="text-xs text-muted-foreground">
          +{groups.length - 3} more day{groups.length - 3 === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
