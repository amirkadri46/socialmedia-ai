"use client";

import { useCallback, useEffect, useState } from "react";
import type { Prospect, ProspectList } from "@/lib/types";

export interface ListMeta {
  id: string;
  name: string;
  createdAt: string;
  count: number;
}

/**
 * Loads the prospect lists + the active list's prospects, and exposes
 * optimistic local patching that persists via the existing PATCH route.
 */
export function useLeads() {
  const [listMetas, setListMetas] = useState<ListMeta[]>([]);
  const [activeListId, setActiveListId] = useState<string>("");
  const [activeList, setActiveList] = useState<ProspectList | null>(null);
  const [loadingList, setLoadingList] = useState(false);

  const loadMetas = useCallback(async () => {
    const res = await fetch("/api/outreach/lists");
    if (res.ok) {
      const metas: ListMeta[] = await res.json();
      setListMetas(metas);
      setActiveListId((cur) => cur || (metas[0]?.id ?? ""));
      return metas;
    }
    return [];
  }, []);

  const loadActiveList = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingList(true);
    try {
      const res = await fetch(`/api/outreach/lists/${id}`);
      if (res.ok) setActiveList(await res.json());
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadMetas();
  }, [loadMetas]);

  useEffect(() => {
    if (activeListId) loadActiveList(activeListId);
  }, [activeListId, loadActiveList]);

  // Patch a prospect locally (optimistic).
  const patchLocal = useCallback((prospectId: string, updates: Partial<Prospect>) => {
    setActiveList((prev) =>
      prev
        ? {
            ...prev,
            prospects: prev.prospects.map((p) =>
              p.id === prospectId ? { ...p, ...updates } : p
            ),
          }
        : prev
    );
  }, []);

  // Patch + persist to the server.
  const updateProspect = useCallback(
    async (prospectId: string, updates: Partial<Prospect>) => {
      patchLocal(prospectId, updates);
      try {
        await fetch("/api/outreach/lists", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId: activeListId, prospectId, updates }),
        });
      } catch {
        /* swallow — local state already updated */
      }
    },
    [activeListId, patchLocal]
  );

  const deleteProspect = useCallback(
    async (prospectId: string) => {
      setActiveList((prev) =>
        prev ? { ...prev, prospects: prev.prospects.filter((p) => p.id !== prospectId) } : prev
      );
      try {
        await fetch(`/api/outreach/lists?listId=${activeListId}&prospectId=${prospectId}`, {
          method: "DELETE",
        });
      } catch {
        /* swallow */
      }
    },
    [activeListId]
  );

  const deleteList = useCallback(
    async (id: string) => {
      await fetch(`/api/outreach/lists?id=${id}`, { method: "DELETE" });
      setActiveList(null);
      setActiveListId("");
      await loadMetas();
    },
    [loadMetas]
  );

  return {
    listMetas,
    activeListId,
    setActiveListId,
    activeList,
    setActiveList,
    loadingList,
    loadMetas,
    loadActiveList,
    patchLocal,
    updateProspect,
    deleteProspect,
    deleteList,
  };
}
