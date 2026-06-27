"use client";

import { useCallback, useRef } from "react";

/** A stable callback whose identity never changes but always calls the latest fn. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCallbackRef<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  // Stable wrapper must keep T's call signature for editor event handlers.
  // eslint-disable-next-line react-hooks/use-memo
  return useCallback(((...args) => ref.current(...args)) as T, []);
}
