"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScheduleRule } from "@/lib/db/types";

// key = stable string for Select; hours = what gets stored in ScheduleRule
const FREQUENCY_OPTIONS = [
  { key: "1m",  hours: 1 / 60,   label: "Every 1 min"  },
  { key: "2m",  hours: 2 / 60,   label: "Every 2 min"  },
  { key: "5m",  hours: 5 / 60,   label: "Every 5 min"  },
  { key: "10m", hours: 10 / 60,  label: "Every 10 min" },
  { key: "15m", hours: 0.25,     label: "Every 15 min" },
  { key: "30m", hours: 0.5,      label: "Every 30 min" },
  { key: "45m", hours: 0.75,     label: "Every 45 min" },
  { key: "1h",  hours: 1,        label: "Every 1h"     },
  { key: "2h",  hours: 2,        label: "Every 2h"     },
  { key: "3h",  hours: 3,        label: "Every 3h"     },
  { key: "4h",  hours: 4,        label: "Every 4h"     },
  { key: "6h",  hours: 6,        label: "Every 6h"     },
  { key: "8h",  hours: 8,        label: "Every 8h"     },
  { key: "12h", hours: 12,       label: "Every 12h"    },
  { key: "24h", hours: 24,       label: "Every 24h"    },
];

const QUICK_START_OPTIONS = [
  { label: "— Set manually —", value: "" },
  { label: "Right now",        value: "0"  },
  { label: "In 5 minutes",     value: "5"  },
  { label: "In 15 minutes",    value: "15" },
  { label: "In 30 minutes",    value: "30" },
  { label: "In 1 hour",        value: "60" },
];

const WINDOW_HOURS = Array.from({ length: 24 }, (_, i) => i);
const TIMEZONES = [
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Dubai",
  "UTC",
];
const RANDOMIZE_OPTIONS = [
  { label: "None",    value: 0  },
  { label: "±5 min",  value: 5  },
  { label: "±10 min", value: 10 },
  { label: "±15 min", value: 15 },
  { label: "±30 min", value: 30 },
];

function toHHMM(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}
function formatHour(h: number) {
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}

function freqKey(hours: number): string {
  const match = FREQUENCY_OPTIONS.find((o) => Math.abs(o.hours - hours) < 0.0001);
  return match?.key ?? "1h";
}

interface Props {
  value: ScheduleRule;
  onChange: (rule: ScheduleRule) => void;
  disabled?: boolean;
}

export function ScheduleRuleEditor({ value, onChange, disabled }: Props) {
  const set = (patch: Partial<ScheduleRule>) => onChange({ ...value, ...patch });

  const applyQuickStart = (delayMinStr: string) => {
    if (!delayMinStr) return;
    const delayMin = Number(delayMinStr);
    const start = new Date(Date.now() + delayMin * 60 * 1000);
    const hh = String(start.getHours()).padStart(2, "0");
    const mm = String(start.getMinutes()).padStart(2, "0");
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const eh = String(end.getHours()).padStart(2, "0");
    const em = String(end.getMinutes()).padStart(2, "0");
    const today = start.toISOString().split("T")[0];
    set({ startDate: today, windowStart: `${hh}:${mm}`, windowEnd: `${eh}:${em}` });
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Quick start — spans full width */}
      <div className="col-span-2 space-y-1.5">
        <Label>Quick start</Label>
        <Select disabled={disabled} value="" onValueChange={applyQuickStart}>
          <SelectTrigger>
            <SelectValue placeholder="— Set manually —" />
          </SelectTrigger>
          <SelectContent>
            {QUICK_START_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} disabled={o.value === ""}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Auto-fills Start date + Window to begin publishing at the selected time.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Frequency</Label>
        <Select
          disabled={disabled}
          value={freqKey(value.frequencyHours)}
          onValueChange={(k) => {
            const o = FREQUENCY_OPTIONS.find((x) => x.key === k);
            if (o) set({ frequencyHours: o.hours });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Timezone</Label>
        <Select
          disabled={disabled}
          value={value.timezone}
          onValueChange={(v) => set({ timezone: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Window start</Label>
        <Select
          disabled={disabled}
          value={value.windowStart}
          onValueChange={(v) => set({ windowStart: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_HOURS.map((h) => (
              <SelectItem key={h} value={toHHMM(h)}>
                {formatHour(h)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Window end</Label>
        <Select
          disabled={disabled}
          value={value.windowEnd}
          onValueChange={(v) => set({ windowEnd: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOW_HOURS.map((h) => (
              <SelectItem key={h} value={toHHMM(h)}>
                {formatHour(h)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Start date</Label>
        <Input
          type="date"
          disabled={disabled}
          value={value.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Randomize</Label>
        <Select
          disabled={disabled}
          value={String(value.randomizeMinutes)}
          onValueChange={(v) => set({ randomizeMinutes: Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANDOMIZE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
