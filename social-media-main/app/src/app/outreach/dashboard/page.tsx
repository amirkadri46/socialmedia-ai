"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Flame,
  TrendingUp,
  MessageSquare,
  CalendarCheck,
  Trophy,
  XCircle,
  Percent,
  DollarSign,
} from "lucide-react";
import { StatCard } from "@/components/outreach/stat-card";
import { PriorityDistribution, PipelineFunnel } from "@/components/outreach/dashboard-charts";
import { Skeleton } from "@/components/ui/skeleton";
import type { PriorityLevel, LeadStatus } from "@/lib/types";

interface Stats {
  totalLeads: number;
  hotLeads: number;
  highPriorityLeads: number;
  messagesGenerated: number;
  meetingsBooked: number;
  wonDeals: number;
  lostDeals: number;
  contacted: number;
  conversionRate: number;
  revenueGenerated: number | null;
  priorityDistribution: Record<PriorityLevel, number>;
  pipeline: Record<LeadStatus, number>;
  listCount: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/outreach/stats")
      .then((r) => r.json())
      .then((s) => setStats(s))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Lead Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Performance across all lead lists{stats ? ` · ${stats.listCount} ${stats.listCount === 1 ? "list" : "lists"}` : ""}.
        </p>
      </div>

      {loading || !stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            <StatCard label="Total Leads" value={stats.totalLeads} icon={Users} />
            <StatCard label="Hot Leads" value={stats.hotLeads} icon={Flame} hint="Priority 90–100" />
            <StatCard label="High Priority" value={stats.highPriorityLeads} icon={TrendingUp} hint="Priority 70–89" />
            <StatCard label="Messages Generated" value={stats.messagesGenerated} icon={MessageSquare} />
            <StatCard label="Meetings Booked" value={stats.meetingsBooked} icon={CalendarCheck} />
            <StatCard label="Won Deals" value={stats.wonDeals} icon={Trophy} />
            <StatCard label="Lost Deals" value={stats.lostDeals} icon={XCircle} />
            <StatCard label="Conversion Rate" value={`${stats.conversionRate}%`} icon={Percent} hint="Won / contacted" />
            <StatCard
              label="Revenue Generated"
              value={stats.revenueGenerated == null ? "—" : `$${stats.revenueGenerated.toLocaleString()}`}
              icon={DollarSign}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <PriorityDistribution data={stats.priorityDistribution} />
            <PipelineFunnel data={stats.pipeline} />
          </div>
        </>
      )}
    </div>
  );
}
