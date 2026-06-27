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

const FREQUENCY_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];
const WINDOW_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6..23
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
  { label: "None", value: 0 },
  { label: "±5 min", value: 5 },
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

interface Props {
  value: ScheduleRule;
  onChange: (rule: ScheduleRule) => void;
  disabled?: boolean;
}

export function ScheduleRuleEditor({ value, onChange, disabled }: Props) {
  const set = (patch: Partial<ScheduleRule>) => onChange({ ...value, ...patch });

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <Label>Frequency</Label>
        <Select
          disabled={disabled}
          value={String(value.frequencyHours)}
          onValueChange={(v) => set({ frequencyHours: Number(v) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREQUENCY_OPTIONS.map((h) => (
              <SelectItem key={h} value={String(h)}>
                Every {h}h
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
