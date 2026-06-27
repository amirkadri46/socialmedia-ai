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
      // Optimistic update
      patchLocal(prospectId, updates);
      try {
        const res = await fetch("/api/outreach/lists", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listId: activeListId, prospectId, updates }),
        });
        if (!res.ok) throw new Error("Failed to update");
      } catch {
        // Rollback on failure by reloading list
        alert("Failed to update prospect on server");
        loadActiveList(activeListId);
      }
    },
    [activeListId, patchLocal, loadActiveList]
  );

  const deleteProspect = useCallback(
    async (prospectId: string) => {
      // Optimistic update
      setActiveList((prev) =>
        prev ? { ...prev, prospects: prev.prospects.filter((p) => p.id !== prospectId) } : prev
      );
      try {
        const res = await fetch(`/api/outreach/lists?listId=${activeListId}&prospectId=${prospectId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete");
      } catch {
        alert("Failed to delete prospect on server");
        loadActiveList(activeListId);
      }
    },
    [activeListId, loadActiveList]
  );

  const deleteList = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/outreach/lists?id=${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete list");
        setActiveList(null);
        setActiveListId("");
        await loadMetas();
      } catch (err) {
        alert("Failed to delete list");
      }
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
