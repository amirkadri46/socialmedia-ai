"use client";

import { useEffect, useMemo, useState } from "react";
import type { Prospect, PriorityLevel, LeadStatus, WebsiteStatus } from "@/lib/types";

export interface LeadFilters {
  priority: PriorityLevel[];
  website: WebsiteStatus[];
  hasEmail: boolean;
  hasPhone: boolean;
  category: string; // "" = all
  location: string; // "" = all
  status: LeadStatus[];
  search: string;
}

export const EMPTY_FILTERS: LeadFilters = {
  priority: [],
  website: [],
  hasEmail: false,
  hasPhone: false,
  category: "",
  location: "",
  status: [],
  search: "",
};

function isActive(f: LeadFilters): boolean {
  return (
    f.priority.length > 0 ||
    f.website.length > 0 ||
    f.hasEmail ||
    f.hasPhone ||
    !!f.category ||
    !!f.location ||
    f.status.length > 0 ||
    !!f.search.trim()
  );
}

/**
 * Client-side filter state for a list, persisted to localStorage per list id.
 * Returns the filtered prospects plus filter controls and derived facet values.
 */
export function useLeadFilters(listId: string, prospects: Prospect[]) {
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);

  // Load persisted filters when the active list changes.
  useEffect(() => {
    if (!listId) {
      setFilters(EMPTY_FILTERS);
      return;
    }
    try {
      const raw = localStorage.getItem(`lead-filters:${listId}`);
      setFilters(raw ? { ...EMPTY_FILTERS, ...JSON.parse(raw) } : EMPTY_FILTERS);
    } catch {
      setFilters(EMPTY_FILTERS);
    }
  }, [listId]);

  // Persist on change.
  useEffect(() => {
    if (!listId) return;
    try {
      localStorage.setItem(`lead-filters:${listId}`, JSON.stringify(filters));
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [listId, filters]);

  const categories = useMemo(
    () => Array.from(new Set(prospects.map((p) => p.businessCategory).filter(Boolean))).sort() as string[],
    [prospects]
  );
  const locations = useMemo(
    () => Array.from(new Set(prospects.map((p) => p.location).filter(Boolean))).sort() as string[],
    [prospects]
  );

  const filtered = useMemo(() => {
    const s = filters.search.trim().toLowerCase();
    return prospects.filter((p) => {
      if (filters.priority.length && !(p.priorityLevel && filters.priority.includes(p.priorityLevel)))
        return false;
      if (filters.website.length && !(p.websiteStatus && filters.website.includes(p.websiteStatus)))
        return false;
      if (filters.hasEmail && !p.email) return false;
      if (filters.hasPhone && !p.phone) return false;
      if (filters.category && p.businessCategory !== filters.category) return false;
      if (filters.location && p.location !== filters.location) return false;
      if (filters.status.length && !(p.leadStatus && filters.status.includes(p.leadStatus)))
        return false;
      if (s) {
        const hay = `${p.fullName ?? ""} ${p.company ?? ""} ${p.headline ?? ""} ${p.businessCategory ?? ""} ${p.location ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [prospects, filters]);

  return {
    filters,
    setFilters,
    filtered,
    categories,
    locations,
    active: isActive(filters),
    clear: () => setFilters(EMPTY_FILTERS),
  };
}
