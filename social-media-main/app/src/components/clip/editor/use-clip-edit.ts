"use client";

import { useCallbackRef } from "@/components/clip/editor/use-callback-ref";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipEdit, Word, Clip } from "@/lib/types";

interface LoadState {
  edit: ClipEdit | null;
  words: Word[];
  clip: Clip | null;
  sourceAvailable: boolean;
  sourceVideoUrl: string | null;
  loading: boolean;
  error: string;
}

/**
 * Owns the ClipEdit document for the editor: load, debounced autosave, and an
 * undo/redo history stack. Everything in the editor is a pure function of `edit`.
 */
export function useClipEdit(jobId: string, clipId: string) {
  const [state, setState] = useState<LoadState>({
    edit: null,
    words: [],
    clip: null,
    sourceAvailable: true,
    sourceVideoUrl: null,
    loading: true,
    error: "",
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const history = useRef<ClipEdit[]>([]);
  const future = useRef<ClipEdit[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clip/${jobId}/${clipId}/edit`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setState((s) => ({ ...s, loading: false, error: data.error }));
        } else {
          setState({
            edit: data.edit,
            words: data.words ?? [],
            clip: data.clip,
            sourceAvailable: data.sourceAvailable !== false,
            sourceVideoUrl: data.sourceVideoUrl ?? null,
            loading: false,
            error: "",
          });
        }
      })
      .catch((e) => setState((s) => ({ ...s, loading: false, error: String(e) })));
    return () => {
      cancelled = true;
    };
  }, [jobId, clipId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const save = useCallbackRef(async (edit: ClipEdit) => {
    setSaving(true);
    try {
      await fetch(`/api/clip/${jobId}/${clipId}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit),
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  });

  // Apply a mutation, push previous onto history, debounce autosave.
  const update = useCallback(
    (mutator: (draft: ClipEdit) => ClipEdit | void) => {
      setState((s) => {
        if (!s.edit) return s;
        history.current.push(s.edit);
        if (history.current.length > 100) history.current.shift();
        future.current = [];
        const draft: ClipEdit = structuredClone(s.edit);
        const result = mutator(draft) ?? draft;
        result.updatedAt = new Date().toISOString();
        setDirty(true);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => save(result), 1200);
        return { ...s, edit: result };
      });
      setCanUndo(true);
      setCanRedo(false);
    },
    [save]
  );

  const undo = useCallback(() => {
    setState((s) => {
      const prev = history.current.pop();
      if (!prev || !s.edit) return s;
      future.current.push(s.edit);
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(prev), 1200);
      return { ...s, edit: prev };
    });
    setCanUndo(history.current.length > 0);
    setCanRedo(true);
  }, [save]);

  const redo = useCallback(() => {
    setState((s) => {
      const next = future.current.pop();
      if (!next || !s.edit) return s;
      history.current.push(s.edit);
      setDirty(true);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), 1200);
      return { ...s, edit: next };
    });
    setCanUndo(true);
    setCanRedo(future.current.length > 0);
  }, [save]);

  const saveNow = useCallback(() => {
    if (state.edit) save(state.edit);
  }, [state.edit, save]);

  return {
    ...state,
    saving,
    dirty,
    canUndo,
    canRedo,
    update,
    undo,
    redo,
    saveNow,
  };
}
