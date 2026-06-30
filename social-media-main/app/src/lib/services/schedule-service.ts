import {
  addHours, parseISO, setHours, setMinutes, startOfDay, addDays,
  isAfter, isBefore, differenceInMinutes, differenceInDays,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type { ScheduleRule } from "../db/types";

// Build a UTC Date for a given YYYY-MM-DD date string + HH:MM time in a timezone.
// Passes an ISO-style string so fromZonedTime parses wall-clock components directly,
// avoiding host-timezone drift from Date local getters.
function slotAtTime(dateStr: string, timeStr: string, tz: string): Date {
  return fromZonedTime(`${dateStr}T${timeStr}:00`, tz);
}

export function computeFirstSlot(rule: ScheduleRule): Date {
  if ((rule.mode ?? "single") === "now") return new Date();
  return slotAtTime(rule.startDate, rule.windowStart, rule.timezone);
}

export function computeNextSlot(rule: ScheduleRule, from: Date): Date {
  const next = addHours(from, rule.frequencyHours);
  if ((rule.mode ?? "single") !== "multi" || !rule.windowEnd) return next;

  const tz = rule.timezone;
  const candidate = toZonedTime(next, tz);
  const [endH, endM] = rule.windowEnd.split(":").map(Number);
  const [startH, startM] = rule.windowStart.split(":").map(Number);
  const candidateDay = startOfDay(candidate);
  const dayEnd = setMinutes(setHours(candidateDay, endH), endM);

  if (isAfter(candidate, dayEnd)) {
    const nextDay = addDays(candidateDay, 1);
    return fromZonedTime(setMinutes(setHours(nextDay, startH), startM), tz);
  }
  return fromZonedTime(candidate, tz);
}

export interface CampaignPreview {
  totalJobs: number;
  totalSlots: number;
  estimatedStart: string;
  estimatedFinish: string;
  durationMinutes: number;
  slots: string[];
  validationError?: string;
  validationInfo?: string; // amber warning — still blocks publishing
}

export function validateSchedule(videoCount: number, rule: ScheduleRule): string | undefined {
  const mode = rule.mode ?? "single";
  if (rule.frequencyHours <= 0) return "Post frequency must be greater than zero.";
  if (mode === "now") return undefined;

  const now = new Date();
  const firstSlot = slotAtTime(rule.startDate, rule.windowStart, rule.timezone);

  if (isBefore(firstSlot, now)) {
    return "Start time is in the past. Choose a future date and time.";
  }

  if (mode === "single") {
    const lastSlot = new Date(firstSlot.getTime() + (videoCount - 1) * rule.frequencyHours * 3_600_000);
    const tz = rule.timezone;
    if (startOfDay(toZonedTime(lastSlot, tz)).getTime() > startOfDay(toZonedTime(firstSlot, tz)).getTime()) {
      return "Schedule runs into the next day. Reduce frequency, fewer videos, or switch to Multiple Days mode.";
    }
    return undefined;
  }

  // multi
  if (!rule.endDate) return "End date is required.";
  if (!rule.windowEnd) return "Daily end time is required.";

  const [startH, startM] = rule.windowStart.split(":").map(Number);
  const [endH, endM] = rule.windowEnd.split(":").map(Number);
  const windowMinutes = (endH * 60 + endM) - (startH * 60 + startM);
  if (windowMinutes <= 0) return "Daily end time must be after daily start time.";

  const endDate = parseISO(rule.endDate);
  if (isBefore(endDate, parseISO(rule.startDate))) return "End date must be on or after start date.";

  const freqMinutes = rule.frequencyHours * 60;
  const slotsPerDay = Math.floor(windowMinutes / freqMinutes) + 1;
  const daysInRange = differenceInDays(endDate, parseISO(rule.startDate)) + 1;
  const totalAvailableSlots = slotsPerDay * daysInRange;

  if (totalAvailableSlots < videoCount) {
    return `Not enough time: ${totalAvailableSlots} slot${totalAvailableSlots === 1 ? "" : "s"} available for ${videoCount} video${videoCount === 1 ? "" : "s"}. Extend the date range, widen the daily window, or post more frequently.`;
  }
  return undefined;
}

// Returns an info message (amber, blocks publish) when a multi-day campaign fits entirely in Day 1.
function checkMultiDayInfo(videoCount: number, rule: ScheduleRule): string | undefined {
  if ((rule.mode ?? "single") !== "multi" || !rule.windowEnd) return undefined;
  const firstSlot = slotAtTime(rule.startDate, rule.windowStart, rule.timezone);
  const dayEnd = slotAtTime(rule.startDate, rule.windowEnd, rule.timezone);
  const naiveLastSlot = new Date(firstSlot.getTime() + (videoCount - 1) * rule.frequencyHours * 3_600_000);
  if (!isAfter(naiveLastSlot, dayEnd)) {
    return "This campaign completes within Day 1. Multiple Days scheduling is not needed — switch to Single Day instead.";
  }
  return undefined;
}

export function calculatePreview(
  videoCount: number,
  accountCount: number,
  rule: ScheduleRule
): CampaignPreview {
  const totalSlots = videoCount;
  const totalJobs = videoCount * accountCount;

  if (totalSlots === 0) {
    return { totalJobs: 0, totalSlots: 0, estimatedStart: "", estimatedFinish: "", durationMinutes: 0, slots: [] };
  }

  const validationError = validateSchedule(videoCount, rule);
  const validationInfo = validationError ? undefined : checkMultiDayInfo(videoCount, rule);

  const firstSlot = computeFirstSlot(rule);
  let current = firstSlot;
  const slots: string[] = [firstSlot.toISOString()];

  for (let i = 1; i < totalSlots; i++) {
    current = computeNextSlot(rule, current);
    slots.push(current.toISOString());
  }

  return {
    totalJobs,
    totalSlots,
    estimatedStart: firstSlot.toISOString(),
    estimatedFinish: current.toISOString(),
    durationMinutes: differenceInMinutes(current, firstSlot),
    slots,
    validationError,
    validationInfo,
  };
}
