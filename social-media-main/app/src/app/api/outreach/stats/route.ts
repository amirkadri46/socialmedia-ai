import { NextResponse } from "next/server";
import { readProspectLists } from "@/lib/outreach";
import { LEAD_STATUS_ORDER, PRIORITY_LEVELS } from "@/lib/lead-scoring";
import type { Prospect, LeadStatus, PriorityLevel } from "@/lib/types";

// GET /api/outreach/stats — aggregate metrics across all lists for the dashboard.
export async function GET() {
  const lists = readProspectLists();
  const all: Prospect[] = lists.flatMap((l) => l.prospects);

  const total = all.length;
  const has = (s: LeadStatus) => all.filter((p) => p.leadStatus === s).length;

  const priorityCounts = Object.fromEntries(
    PRIORITY_LEVELS.map((lvl) => [lvl, all.filter((p) => p.priorityLevel === lvl).length])
  ) as Record<PriorityLevel, number>;

  const pipelineCounts = Object.fromEntries(
    LEAD_STATUS_ORDER.map((s) => [s, has(s)])
  ) as Record<LeadStatus, number>;

  const messagesGenerated = all.filter((p) => p.whatsappMessage || p.emailMessage).length;
  const contacted = all.filter(
    (p) => p.leadStatus && p.leadStatus !== "new" && p.leadStatus !== "not_relevant"
  ).length;
  const won = has("won");
  const lost = has("lost");
  const revenue = all.reduce((sum, p) => sum + (p.dealValue || 0), 0);
  const hasRevenue = all.some((p) => typeof p.dealValue === "number");

  return NextResponse.json({
    totalLeads: total,
    hotLeads: priorityCounts.hot,
    highPriorityLeads: priorityCounts.high,
    messagesGenerated,
    meetingsBooked: has("meeting_booked"),
    wonDeals: won,
    lostDeals: lost,
    contacted,
    conversionRate: contacted > 0 ? Math.round((won / contacted) * 100) : 0,
    revenueGenerated: hasRevenue ? revenue : null,
    priorityDistribution: priorityCounts,
    pipeline: pipelineCounts,
    listCount: lists.length,
  });
}
