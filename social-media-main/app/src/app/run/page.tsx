"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play, Loader2, CheckCircle2, XCircle, Terminal, Zap, ChevronDown,
  ArrowRight, Film, AlertTriangle, Users, Settings2, Link2, Plus, X,
} from "lucide-react";
import { usePipeline } from "@/context/pipeline-context";
import type { Config, Creator, PipelineProgress, Video } from "@/lib/types";

interface UrlAnalysisState {
  status: "running" | "completed" | "error";
  step: string;
  log: string[];
  error?: string;
  video?: Video;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

type CreatorOverrideMap = Record<string, { nDays?: number; maxVideos?: number; topK?: number }>;

function PipelineProgressPanel({ progress }: { progress: PipelineProgress }) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progress.log.length]);

  const totalProgress =
    progress.phase === "scraping"
      ? progress.creatorsTotal > 0 ? (progress.creatorsScraped / progress.creatorsTotal) * 40 : 0
      : progress.videosTotal > 0 ? 40 + (progress.videosAnalyzed / progress.videosTotal) * 60 : 40;

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="glass rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {progress.status === "running" && <Loader2 className="h-4 w-4 text-purple-400 animate-spin" />}
            {progress.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            {progress.status === "error" && <XCircle className="h-4 w-4 text-red-400" />}
            <h2 className="text-sm font-semibold">
              {progress.status === "running" && progress.phase === "scraping" && "Scraping creators..."}
              {progress.status === "running" && progress.phase === "analyzing" && "Analyzing videos..."}
              {progress.status === "completed" && "Pipeline complete"}
              {progress.status === "error" && "Pipeline failed"}
            </h2>
            <span className="text-xs text-muted-foreground font-mono ml-1">· {progress.configName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {progress.phase === "scraping" && (
              <span>Creators: <span className="text-foreground">{progress.creatorsScraped}/{progress.creatorsTotal}</span></span>
            )}
            {(progress.phase === "analyzing" || progress.phase === "done") && (
              <span>Videos: <span className="text-foreground">{progress.videosAnalyzed}/{progress.videosTotal}</span></span>
            )}
            {progress.errors.length > 0 && (
              <span className="inline-flex items-center gap-1 text-red-400">
                <AlertTriangle className="h-3 w-3" />
                {progress.errors.length}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="h-2 rounded-full bg-white/[0.05] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progress.status === "completed"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                  : progress.status === "error"
                  ? "bg-gradient-to-r from-red-500 to-orange-500"
                  : "bg-gradient-to-r from-purple-500 to-indigo-500"
              }`}
              style={{ width: `${progress.status === "completed" ? 100 : totalProgress}%` }}
            />
          </div>
        </div>

        {/* Active tasks */}
        {progress.activeTasks.length > 0 && (
          <div className="space-y-2">
            {progress.activeTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.04] px-3 py-2"
              >
                <Loader2 className="h-3 w-3 text-purple-400 animate-spin shrink-0" />
                <span className="text-xs font-medium text-foreground/80">@{task.creator}</span>
                <span className="text-[11px] text-muted-foreground">{task.step}</span>
                {task.views && (
                  <span className="ml-auto text-[11px] text-muted-foreground/60">
                    {formatViews(task.views)} views
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Completion CTA */}
        {progress.status === "completed" && progress.videosAnalyzed > 0 && (
          <Button asChild className="w-full rounded-xl h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 border-0 font-semibold gap-2">
            <Link href="/videos">
              <Film className="h-4 w-4" />
              View {progress.videosAnalyzed} New Videos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}

        {/* Errors summary */}
        {progress.errors.length > 0 && (
          <div className="rounded-xl bg-red-500/5 border border-red-500/10 p-3 space-y-1">
            <p className="text-[11px] font-medium text-red-400">Errors ({progress.errors.length})</p>
            {progress.errors.map((err, i) => (
              <p key={i} className="text-[11px] text-red-400/70 leading-relaxed">{err}</p>
            ))}
          </div>
        )}
      </div>

      {/* Log — collapsible */}
      <details className="glass rounded-2xl overflow-hidden">
        <summary className="p-4 flex items-center gap-2 cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
          <Terminal className="h-4 w-4" />
          <span className="font-medium">Log</span>
          <Badge variant="secondary" className="ml-auto rounded-md text-[10px] bg-white/[0.05] border border-white/[0.06]">
            {progress.log.length} entries
          </Badge>
        </summary>
        <div className="border-t border-white/[0.06]">
          <ScrollArea className="h-[300px] p-4">
            <div className="space-y-0.5 font-mono text-[11px]">
              {progress.log.map((line, i) => (
                <div
                  key={i}
                  className={`leading-5 ${
                    line.includes("Error") || line.includes("error")
                      ? "text-red-400"
                      : line.includes("done") || line.includes("complete") || line.includes("Complete")
                      ? "text-emerald-400/80"
                      : "text-muted-foreground"
                  }`}
                >
                  {line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </ScrollArea>
        </div>
      </details>
    </div>
  );
}

const MAX_PANELS = 4;

function AnalyzeVideoPanel({
  panelId,
  configs,
  allCreators,
  onRemove,
  canRemove,
}: {
  panelId: string;
  configs: Config[];
  allCreators: Creator[];
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [analyzeUrl, setAnalyzeUrl] = useState("");
  const [analyzeConfig, setAnalyzeConfig] = useState("");
  const [analyzeCreator, setAnalyzeCreator] = useState("auto");
  const [analyzeRunning, setAnalyzeRunning] = useState(false);
  const [analyzeState, setAnalyzeState] = useState<UrlAnalysisState | null>(null);

  const analyzeConfigObj = configs.find((c) => c.configName === analyzeConfig);
  const analyzeCreators = analyzeConfigObj
    ? allCreators.filter((c) => c.category === analyzeConfigObj.creatorsCategory)
    : allCreators;

  const handleAnalyzeUrl = async () => {
    if (!analyzeUrl.trim() || !analyzeConfig || analyzeRunning) return;
    setAnalyzeRunning(true);
    setAnalyzeState({ status: "running", step: "Starting...", log: [] });

    try {
      const response = await fetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: analyzeUrl.trim(),
          configName: analyzeConfig,
          creatorOverride: analyzeCreator !== "auto" ? analyzeCreator : undefined,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => `HTTP ${response.status}`);
        setAnalyzeState({ status: "error", step: "Failed", log: [], error: text || `HTTP ${response.status}` });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setAnalyzeState({ status: "error", step: "Failed", log: [], error: "No response body received" });
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
            try { setAnalyzeState(JSON.parse(line.slice(6))); } catch { /* skip */ }
          }
        }
      }
    } catch (err) {
      setAnalyzeState({
        status: "error",
        step: "Failed",
        log: [],
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setAnalyzeRunning(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-5 space-y-4 flex flex-col min-w-0">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="text-sm font-semibold">Analyze Video</span>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-3 flex-1">
        <div>
          <Label className="text-xs text-muted-foreground">Instagram Reel URL</Label>
          <Input
            type="url"
            placeholder="https://www.instagram.com/reel/..."
            value={analyzeUrl}
            onChange={(e) => setAnalyzeUrl(e.target.value)}
            className="mt-1.5 rounded-xl glass border-white/[0.08] h-10 text-sm"
          />
        </div>

        <div className="grid gap-2 grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Config</Label>
            <Select value={analyzeConfig} onValueChange={(v) => { setAnalyzeConfig(v); setAnalyzeCreator("auto"); }}>
              <SelectTrigger className="mt-1.5 rounded-xl glass border-white/[0.08] h-10 text-sm">
                <SelectValue placeholder="Select config..." />
              </SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.configName}>{c.configName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Assign to Creator</Label>
            <Select value={analyzeCreator} onValueChange={setAnalyzeCreator}>
              <SelectTrigger className="mt-1.5 rounded-xl glass border-white/[0.08] h-10 text-sm">
                <SelectValue placeholder="Auto-detect" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect from URL</SelectItem>
                {analyzeCreators.map((c) => (
                  <SelectItem key={c.id} value={c.username}>@{c.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={handleAnalyzeUrl}
          disabled={analyzeRunning || !analyzeUrl.trim() || !analyzeConfig}
          size="lg"
          className="w-full rounded-xl h-11 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 border-0 transition-all duration-300 text-sm font-semibold"
        >
          {analyzeRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Film className="h-4 w-4" />
              Analyze Video
            </>
          )}
        </Button>

        {analyzeState && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06]">
              {analyzeState.status === "running" && <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />}
              {analyzeState.status === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
              {analyzeState.status === "error" && <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
              <span className="text-xs font-medium truncate">{analyzeState.step}</span>
              {analyzeState.status === "completed" && (
                <Link href="/videos" className="ml-auto text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors shrink-0">
                  View <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            {analyzeState.error && (
              <p className="px-3 py-2 text-[11px] text-red-400/80">{analyzeState.error}</p>
            )}
            {analyzeState.log.length > 0 && (
              <div className="px-3 py-2.5 space-y-0.5 font-mono text-[11px] max-h-40 overflow-y-auto">
                {analyzeState.log.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.includes("Error") ? "text-red-400" :
                      line.includes("Done") ? "text-emerald-400/80" :
                      "text-muted-foreground"
                    }
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RunPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [allCreators, setAllCreators] = useState<Creator[]>([]);
  const [selectedConfig, setSelectedConfig] = useState("");
  const [maxVideos, setMaxVideos] = useState(20);
  const [topK, setTopK] = useState(3);
  const [nDays, setNDays] = useState(30);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedCreatorUsernames, setSelectedCreatorUsernames] = useState<Set<string>>(new Set());
  const [creatorOverrides, setCreatorOverrides] = useState<CreatorOverrideMap>({});
  const [expandedCreator, setExpandedCreator] = useState<string | null>(null);
  const prevConfigRef = useRef<string>("");

  // Multi-panel analyze state
  const [analyzePanels, setAnalyzePanels] = useState<string[]>(["panel-1"]);
  const nextPanelId = useRef(2);

  const { pipelines, runPipeline } = usePipeline();

  const isThisConfigRunning = pipelines.some(
    (p) => p.configName === selectedConfig && p.status === "running"
  );

  useEffect(() => {
    fetch("/api/configs").then((r) => r.json()).then(setConfigs);
    fetch("/api/creators").then((r) => r.json()).then(setAllCreators);
  }, []);

  // Reset creator selections when selected config changes
  useEffect(() => {
    if (!selectedConfig || selectedConfig === prevConfigRef.current) return;
    prevConfigRef.current = selectedConfig;

    const config = configs.find((c) => c.configName === selectedConfig);
    if (!config) return;
    const creatorsForConfig = allCreators.filter((c) => c.category === config.creatorsCategory);
    setSelectedCreatorUsernames(new Set(creatorsForConfig.map((c) => c.username)));
    setCreatorOverrides({});
    setExpandedCreator(null);
  }, [selectedConfig, configs, allCreators]);

  const currentConfig = configs.find((c) => c.configName === selectedConfig);
  const configCreators = currentConfig
    ? allCreators.filter((c) => c.category === currentConfig.creatorsCategory)
    : [];

  const toggleCreator = (username: string, checked: boolean) => {
    const next = new Set(selectedCreatorUsernames);
    if (checked) next.add(username); else next.delete(username);
    setSelectedCreatorUsernames(next);
  };

  const setOverride = (username: string, field: "nDays" | "maxVideos" | "topK", value: string) => {
    setCreatorOverrides((prev) => ({
      ...prev,
      [username]: { ...prev[username], [field]: value ? Number(value) : undefined },
    }));
  };

  const handleRun = () => {
    if (!selectedConfig) return;

    const allSelected = selectedCreatorUsernames.size === configCreators.length;
    const overridesList = Object.entries(creatorOverrides)
      .filter(([, v]) => v.nDays !== undefined || v.maxVideos !== undefined || v.topK !== undefined)
      .map(([username, v]) => ({ username, ...v }));

    runPipeline({
      configName: selectedConfig,
      maxVideos,
      topK,
      nDays,
      selectedCreators: allSelected ? undefined : Array.from(selectedCreatorUsernames),
      creatorOverrides: overridesList.length > 0 ? overridesList : undefined,
    });
  };

  const addPanel = () => {
    if (analyzePanels.length >= MAX_PANELS) return;
    setAnalyzePanels((prev) => [...prev, `panel-${nextPanelId.current++}`]);
  };

  const removePanel = (id: string) => {
    setAnalyzePanels((prev) => prev.filter((p) => p !== id));
  };

  const gridClass = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  }[analyzePanels.length] ?? "grid-cols-1";

  return (
    <div className="space-y-8">
      {/* Centered zone: header + pipeline config */}
      <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Run Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Analyze competitor content and generate new video concepts
        </p>
      </div>

      {/* Config Form */}
      <div className="glass rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-purple-400" />
          <h2 className="text-sm font-semibold">Pipeline Configuration</h2>
        </div>

        <div className="space-y-4">
          {/* Config selector */}
          <div>
            <Label className="text-xs text-muted-foreground">Config</Label>
            <Select value={selectedConfig} onValueChange={setSelectedConfig}>
              <SelectTrigger className="mt-1.5 rounded-xl glass border-white/[0.08] h-11">
                <SelectValue placeholder="Select a config..." />
              </SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.configName}>{c.configName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Creator selection — shown once a config is selected */}
          {selectedConfig && configCreators.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Users className="h-3 w-3" />
                  Creators
                  <span className="text-foreground/50 ml-0.5">
                    {selectedCreatorUsernames.size}/{configCreators.length}
                  </span>
                </Label>
                <button
                  onClick={() => {
                    if (selectedCreatorUsernames.size === configCreators.length) {
                      setSelectedCreatorUsernames(new Set());
                    } else {
                      setSelectedCreatorUsernames(new Set(configCreators.map((c) => c.username)));
                    }
                  }}
                  className="text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
                >
                  {selectedCreatorUsernames.size === configCreators.length ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
                {configCreators.map((creator) => {
                  const isSelected = selectedCreatorUsernames.has(creator.username);
                  const override = creatorOverrides[creator.username];
                  const isExpanded = expandedCreator === creator.username;
                  const hasOverride = override?.nDays !== undefined || override?.maxVideos !== undefined || override?.topK !== undefined;

                  return (
                    <div
                      key={creator.username}
                      className={`rounded-xl border transition-all duration-200 ${
                        isSelected
                          ? "border-white/[0.08] bg-white/[0.03]"
                          : "border-white/[0.03] opacity-40"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleCreator(creator.username, e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-purple-500 cursor-pointer shrink-0"
                        />
                        <span className="text-xs font-medium flex-1 truncate">@{creator.username}</span>
                        {creator.followers > 0 && (
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            {formatViews(creator.followers)}
                          </span>
                        )}
                        {hasOverride && (
                          <Badge className="text-[9px] py-0 px-1.5 h-4 bg-indigo-500/15 text-indigo-300 border-indigo-500/20 rounded shrink-0">
                            custom
                          </Badge>
                        )}
                        {isSelected && (
                          <button
                            onClick={() => setExpandedCreator(isExpanded ? null : creator.username)}
                            className={`h-5 w-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                              isExpanded || hasOverride
                                ? "text-purple-400"
                                : "text-muted-foreground/40 hover:text-muted-foreground"
                            }`}
                          >
                            <Settings2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>

                      {isSelected && isExpanded && (
                        <div className="px-3 pb-3 pt-1.5 border-t border-white/[0.04]">
                          <p className="text-[10px] text-muted-foreground mb-2">
                            Override defaults for @{creator.username}
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-[10px] text-muted-foreground">Days lookback</Label>
                              <Input
                                type="number"
                                placeholder={String(nDays)}
                                value={override?.nDays ?? ""}
                                onChange={(e) => setOverride(creator.username, "nDays", e.target.value)}
                                min={1}
                                max={365}
                                className="mt-1 h-7 text-xs rounded-lg glass border-white/[0.08]"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">Max videos</Label>
                              <Input
                                type="number"
                                placeholder={String(maxVideos)}
                                value={override?.maxVideos ?? ""}
                                onChange={(e) => setOverride(creator.username, "maxVideos", e.target.value)}
                                min={1}
                                max={100}
                                className="mt-1 h-7 text-xs rounded-lg glass border-white/[0.08]"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">Top K</Label>
                              <Input
                                type="number"
                                placeholder={String(topK)}
                                value={override?.topK ?? ""}
                                onChange={(e) => setOverride(creator.username, "topK", e.target.value)}
                                min={1}
                                max={10}
                                className="mt-1 h-7 text-xs rounded-lg glass border-white/[0.08]"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Global advanced settings (defaults applied to all non-overridden creators) */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
            {configCreators.length > 0 ? "Global defaults" : "Advanced settings"}
          </button>

          {showAdvanced && (
            <div className="grid gap-4 md:grid-cols-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div>
                <Label className="text-xs text-muted-foreground">Max Videos per Creator</Label>
                <Input
                  type="number"
                  value={maxVideos}
                  onChange={(e) => setMaxVideos(Number(e.target.value))}
                  min={1}
                  max={100}
                  className="mt-1.5 rounded-xl glass border-white/[0.08] h-11"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Top K to Analyze</Label>
                <Input
                  type="number"
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  min={1}
                  max={10}
                  className="mt-1.5 rounded-xl glass border-white/[0.08] h-11"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Days Lookback</Label>
                <Input
                  type="number"
                  value={nDays}
                  onChange={(e) => setNDays(Number(e.target.value))}
                  min={1}
                  max={365}
                  className="mt-1.5 rounded-xl glass border-white/[0.08] h-11"
                />
              </div>
            </div>
          )}

          <Button
            onClick={handleRun}
            disabled={isThisConfigRunning || !selectedConfig || selectedCreatorUsernames.size === 0}
            size="lg"
            className="w-full rounded-xl h-12 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 border-0 glow-sm transition-all duration-300 hover:glow text-sm font-semibold"
          >
            {isThisConfigRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running Pipeline...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run Pipeline
                {selectedCreatorUsernames.size > 0 && configCreators.length > 0 && (
                  <span className="ml-1 opacity-60 text-xs">
                    ({selectedCreatorUsernames.size} creator{selectedCreatorUsernames.size !== 1 ? "s" : ""})
                  </span>
                )}
              </>
            )}
          </Button>
        </div>
      </div>
      </div>{/* end centered zone */}

      {/* Analyze Specific Videos — full-width multi-panel */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold">Analyze Specific Videos</h2>
            <Badge variant="secondary" className="rounded-md text-[10px] bg-white/[0.05] border border-white/[0.06] tabular-nums">
              {analyzePanels.length} / {MAX_PANELS}
            </Badge>
          </div>
          <Button
            onClick={addPanel}
            disabled={analyzePanels.length >= MAX_PANELS}
            variant="outline"
            size="sm"
            className="h-8 rounded-xl border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] text-xs gap-1.5 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Video
          </Button>
        </div>

        <div className={`grid gap-3 ${gridClass}`}>
          {analyzePanels.map((id) => (
            <AnalyzeVideoPanel
              key={id}
              panelId={id}
              configs={configs}
              allCreators={allCreators}
              onRemove={() => removePanel(id)}
              canRemove={analyzePanels.length > 1}
            />
          ))}
        </div>
      </div>

      {/* All pipeline progress panels — newest on top, centered */}
      {pipelines.length > 0 && (
        <div className="max-w-4xl mx-auto space-y-8">
          {[...pipelines].reverse().map((p) => (
            <PipelineProgressPanel key={p.pipelineId} progress={p} />
          ))}
        </div>
      )}
    </div>
  );
}
