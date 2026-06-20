"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { v4 as uuid } from "uuid";
import type { PipelineProgress, PipelineParams } from "@/lib/types";

interface PipelineContextValue {
  pipelines: PipelineProgress[];
  runPipeline: (params: PipelineParams) => void;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [pipelines, setPipelines] = useState<PipelineProgress[]>([]);

  const runPipeline = useCallback(async (params: PipelineParams) => {
    const pipelineId = uuid();

    const initial: PipelineProgress = {
      pipelineId,
      configName: params.configName,
      status: "running",
      phase: "scraping",
      activeTasks: [],
      creatorsCompleted: 0,
      creatorsTotal: 0,
      creatorsScraped: 0,
      videosAnalyzed: 0,
      videosTotal: 0,
      errors: [],
      log: [],
    };

    setPipelines((prev) => [...prev, initial]);

    const setError = (msg: string) =>
      setPipelines((prev) =>
        prev.map((p) =>
          p.pipelineId === pipelineId
            ? { ...p, status: "error" as const, errors: [msg] }
            : p
        )
      );

    try {
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => `HTTP ${response.status}`);
        setError(text || `HTTP ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError("No response body received from server");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              setPipelines((prev) =>
                prev.map((p) =>
                  p.pipelineId === pipelineId
                    ? { ...data, pipelineId, configName: params.configName }
                    : p
                )
              );
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  return (
    <PipelineContext.Provider value={{ pipelines, runPipeline }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within PipelineProvider");
  return ctx;
}
