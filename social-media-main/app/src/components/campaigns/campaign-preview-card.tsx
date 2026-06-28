"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { CampaignPreview } from "@/lib/services/schedule-service";
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
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!campaignId || (videoCount === 0 && accountCount === 0)) {
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`/api/campaigns/${campaignId}/preview`)
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok || typeof body.totalJobs !== "number") throw new Error(body.error ?? "Preview failed");
          setPreview(body);
        })
        .catch((e) => {
          setPreview(null);
          setError(e instanceof Error ? e.message : "Preview failed");
        })
        .finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [campaignId, videoCount, accountCount]);

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
      {loading || !preview ? (
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        )
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
          </div>
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
