"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronDown } from "lucide-react";
import type { ScheduleRule } from "@/lib/db/types";

const FREQUENCY_OPTIONS = [
  { key: "5m",  hours: 5 / 60,  label: "Every 5 min"   },
  { key: "10m", hours: 10 / 60, label: "Every 10 min"  },
  { key: "15m", hours: 0.25,    label: "Every 15 min"  },
  { key: "30m", hours: 0.5,     label: "Every 30 min"  },
  { key: "45m", hours: 0.75,    label: "Every 45 min"  },
  { key: "1h",  hours: 1,       label: "Every 1 hour"  },
  { key: "2h",  hours: 2,       label: "Every 2 hours" },
  { key: "3h",  hours: 3,       label: "Every 3 hours" },
  { key: "4h",  hours: 4,       label: "Every 4 hours" },
  { key: "6h",  hours: 6,       label: "Every 6 hours" },
  { key: "8h",  hours: 8,       label: "Every 8 hours" },
  { key: "12h", hours: 12,      label: "Every 12 hours"},
  { key: "24h", hours: 24,      label: "Every 24 hours"},
];

const RANDOMIZE_OPTIONS = [
  { label: "None",    value: 0   },
  { label: "±30 sec", value: 0.5 },
  { label: "±1 min",  value: 1   },
  { label: "±2 min",  value: 2   },
  { label: "±5 min",  value: 5   },
];

const TIMEZONES = [
  "Asia/Kolkata", "America/New_York", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Dubai", "UTC",
];

function freqKey(hours: number): string {
  return FREQUENCY_OPTIONS.find((o) => Math.abs(o.hours - hours) < 0.0001)?.key ?? "1h";
}

function localToday(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

function addHoursToTime(timeStr: string, hours: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h + hours;
  return `${String(Math.min(Math.floor(total), 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface Props {
  value: ScheduleRule;
  onChange: (rule: ScheduleRule) => void;
  disabled?: boolean;
}

const MODE_LABELS = { now: "Start Now", single: "Single Day", multi: "Multiple Days" } as const;
const MODE_DESCRIPTIONS = {
  now: "Campaign starts immediately when published. Finish time is calculated automatically.",
  single: "All posts publish in one session on a single day. Finish time is calculated automatically.",
  multi: "Posts publish across multiple days within a daily window you define.",
} as const;

export function ScheduleRuleEditor({ value, onChange, disabled }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const set = (patch: Partial<ScheduleRule>) => onChange({ ...value, ...patch });
  const mode = value.mode ?? "single";

  const handleModeChange = (newMode: "now" | "single" | "multi") => {
    if (newMode === mode) return;
    if (newMode === "multi" && !value.endDate) {
      set({
        mode: newMode,
        endDate: addDaysStr(value.startDate || localToday(value.timezone), 7),
        windowEnd: value.windowEnd ?? addHoursToTime(value.windowStart || "09:00", 9),
      });
    } else {
      set({ mode: newMode });
    }
  };

  return (
    <div className="space-y-4">
      {/* Segmented mode tabs */}
      <div className="flex rounded-lg border border-border overflow-hidden text-sm">
        {(["now", "single", "multi"] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => handleModeChange(m)}
            className={`flex-1 py-2 font-medium transition-colors
              ${mode === m
                ? "bg-purple-600 text-white"
                : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-zinc-800"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{MODE_DESCRIPTIONS[mode]}</p>

      <div className="grid grid-cols-2 gap-4">
        {/* Single Day: start date + start time */}
        {mode === "single" && (
          <>
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input
                type="date"
                disabled={disabled}
                value={value.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Start Time</Label>
              <Input
                type="time"
                disabled={disabled}
                value={value.windowStart}
                onChange={(e) => set({ windowStart: e.target.value })}
              />
            </div>
          </>
        )}

        {/* Multiple Days: date range + daily window */}
        {mode === "multi" && (
          <>
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input
                type="date"
                disabled={disabled}
                value={value.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input
                type="date"
                disabled={disabled}
                value={value.endDate ?? ""}
                onChange={(e) => set({ endDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Daily Start</Label>
              <Input
                type="time"
                disabled={disabled}
                value={value.windowStart}
                onChange={(e) => set({ windowStart: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Daily End</Label>
              <Input
                type="time"
                disabled={disabled}
                value={value.windowEnd ?? ""}
                onChange={(e) => set({ windowEnd: e.target.value })}
              />
            </div>
          </>
        )}

        {/* Frequency — all modes */}
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
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((o) => (
                <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Randomize — all modes */}
        <div className="space-y-1.5">
          <Label>Randomize</Label>
          <Select
            disabled={disabled}
            value={String(value.randomizeMinutes)}
            onValueChange={(v) => set({ randomizeMinutes: Number(v) })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANDOMIZE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Advanced: timezone */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${advancedOpen ? "rotate-180" : ""}`} />
        Advanced
      </button>
      {advancedOpen && (
        <div className="space-y-1.5">
          <Label>Timezone</Label>
          <Select
            disabled={disabled}
            value={value.timezone}
            onValueChange={(v) => set({ timezone: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
