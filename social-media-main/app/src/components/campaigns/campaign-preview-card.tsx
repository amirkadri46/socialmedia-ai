"use client";

import { useMemo } from "react";
import { calculatePreview } from "@/lib/services/schedule-service";
import type { ScheduleRule } from "@/lib/db/types";

interface Props {
  campaignId: string;
  videoCount: number;
  accountCount: number;
  scheduleRule?: ScheduleRule;
}

function fmt(iso: string, tz: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function CampaignPreviewCard({ campaignId, videoCount, accountCount, scheduleRule }: Props) {
  const preview = useMemo(
    () => scheduleRule ? calculatePreview(videoCount, accountCount, scheduleRule) : null,
    [videoCount, accountCount, scheduleRule]
  );

  if (!campaignId || (videoCount === 0 && accountCount === 0)) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Select videos and accounts to see preview.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-semibold">Campaign Preview</p>
      <div className="border-t border-border" />
      {!preview ? (
        <p className="text-sm text-muted-foreground">Schedule preview unavailable.</p>
      ) : (
        <div className="text-sm space-y-1.5">
          <Row label="Videos selected" value={videoCount} />
          <Row label="Accounts" value={accountCount} />
          <Row label="Total jobs" value={preview.totalJobs.toLocaleString()} />
          {scheduleRule && (
            <Row label="Frequency" value={scheduleRule.frequencyHours < 1 ? `Every ${Math.round(scheduleRule.frequencyHours * 60)} min` : `Every ${scheduleRule.frequencyHours}h`} />
          )}
          {scheduleRule && (
            <Row label="Window" value={`${scheduleRule.windowStart} – ${scheduleRule.windowEnd}`} />
          )}
          <Row label="Estimated duration" value={`${preview.estimatedDurationDays} days`} />
          <div className="border-t border-border pt-1.5 mt-1.5 space-y-1.5">
            <Row label="First post" value={fmt(preview.firstPost, scheduleRule?.timezone ?? "UTC")} />
            <Row label="Last post" value={fmt(preview.lastPost, scheduleRule?.timezone ?? "UTC")} />
            {preview.slots.slice(0, 5).map((slot, i) => (
              <Row key={`${slot}-${i}`} label={`Slot ${i + 1}`} value={fmt(slot, scheduleRule?.timezone ?? "UTC")} />
            ))}
          </div>
          {scheduleRule && scheduleRule.randomizeMinutes > 0 && (
            <p className="text-xs text-muted-foreground">
              Each slot may shift by up to {scheduleRule.randomizeMinutes} minutes when jobs are generated.
            </p>
          )}
        </div>
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
