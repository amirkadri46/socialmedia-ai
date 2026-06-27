import { addHours, parseISO, setHours, setMinutes, startOfDay, addDays, isAfter, isBefore } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type { ScheduleRule } from "@/lib/db/types";

export function computeNextSlot(rule: ScheduleRule, from: Date): Date {
  const tz = rule.timezone;
  let candidate = toZonedTime(addHours(from, rule.frequencyHours), tz);

  const [winStartH, winStartM] = rule.windowStart.split(":").map(Number);
  const [winEndH, winEndM] = rule.windowEnd.split(":").map(Number);

  const candidateDay = startOfDay(candidate);
  const windowStart = setMinutes(setHours(candidateDay, winStartH), winStartM);
  const windowEnd = setMinutes(setHours(candidateDay, winEndH), winEndM);

  if (isBefore(candidate, windowStart)) {
    candidate = windowStart;
  } else if (isAfter(candidate, windowEnd)) {
    const nextDay = addDays(candidateDay, 1);
    candidate = setMinutes(setHours(nextDay, winStartH), winStartM);
  }

  return fromZonedTime(candidate, tz);
}

export function computeFirstSlot(rule: ScheduleRule): Date {
  const tz = rule.timezone;
  const [winStartH, winStartM] = rule.windowStart.split(":").map(Number);
  const startDate = parseISO(rule.startDate);
  const zonedStart = toZonedTime(startDate, tz);
  const firstSlot = setMinutes(setHours(startOfDay(zonedStart), winStartH), winStartM);
  return fromZonedTime(firstSlot, tz);
}

export interface CampaignPreview {
  totalJobs: number;
  estimatedDurationDays: number;
  firstPost: string;
  lastPost: string;
}

export function calculatePreview(
  videoCount: number,
  accountCount: number,
  rule: ScheduleRule
): CampaignPreview {
  const totalJobs = videoCount * accountCount;
  if (totalJobs === 0) return { totalJobs: 0, estimatedDurationDays: 0, firstPost: "", lastPost: "" };

  const firstPost = computeFirstSlot(rule);

  let current = firstPost;
  for (let i = 1; i < videoCount; i++) {
    current = computeNextSlot(rule, current);
  }
  const lastPost = current;

  const durationMs = lastPost.getTime() - firstPost.getTime();
  const estimatedDurationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));

  return {
    totalJobs,
    estimatedDurationDays,
    firstPost: firstPost.toISOString(),
    lastPost: lastPost.toISOString(),
  };
}
