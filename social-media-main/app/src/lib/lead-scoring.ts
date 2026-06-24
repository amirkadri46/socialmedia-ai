import type { PriorityLevel, LeadStatus } from "./types";

// Level is ALWAYS derived from the numeric score — the model never picks the bucket.
export function levelFromScore(score: number): PriorityLevel {
  if (score >= 90) return "hot"; // 90–100 Hot Lead
  if (score >= 70) return "high"; // 70–89  High Priority
  if (score >= 50) return "medium"; // 50–69  Medium Priority
  return "low"; // 0–49   Low Priority
}

export const LEVEL_META: Record<PriorityLevel, { label: string; color: string }> = {
  hot: { label: "Hot Lead", color: "#ef4444" },
  high: { label: "High Priority", color: "#f59e0b" },
  medium: { label: "Medium Priority", color: "#3b82f6" },
  low: { label: "Low Priority", color: "#6b7280" },
};

export const PRIORITY_LEVELS: PriorityLevel[] = ["hot", "high", "medium", "low"];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow Up",
  meeting_booked: "Meeting Booked",
  proposal_sent: "Proposal Sent",
  won: "Won",
  lost: "Lost",
  not_relevant: "Not Relevant",
};

// Ordered pipeline (used for the dashboard funnel + status select ordering)
export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "new",
  "contacted",
  "interested",
  "follow_up",
  "meeting_booked",
  "proposal_sent",
  "won",
  "lost",
  "not_relevant",
];

// Small muted semantic scale for status dots (monochrome app otherwise).
export const STATUS_META: Record<LeadStatus, { label: string; color: string }> = {
  new: { label: "New", color: "#6b7280" },
  contacted: { label: "Contacted", color: "#3b82f6" },
  interested: { label: "Interested", color: "#8b5cf6" },
  follow_up: { label: "Follow Up", color: "#f59e0b" },
  meeting_booked: { label: "Meeting Booked", color: "#14b8a6" },
  proposal_sent: { label: "Proposal Sent", color: "#0ea5e9" },
  won: { label: "Won", color: "#22c55e" },
  lost: { label: "Lost", color: "#ef4444" },
  not_relevant: { label: "Not Relevant", color: "#52525b" },
};

export const WEBSITE_STATUS_LABELS: Record<string, string> = {
  has_website: "Has Website",
  no_website: "No Website",
  social_only: "Social Only",
  unknown: "Unknown",
};
