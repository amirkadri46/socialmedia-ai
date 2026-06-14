"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal, Eye, EyeOff, Check } from "lucide-react";

const OPENROUTER_MODELS = [
  { value: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "openrouter/owl-alpha", label: "OpenRouter Owl Alpha" },
  { value: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "NVIDIA Nemotron Ultra 550B (Free)" },
  { value: "openai/gpt-oss-120b", label: "OpenAI GPT OSS 120B" },
  { value: "tencent/hy3-preview", label: "Tencent HY3 Preview" },
];

type Provider = "openai" | "openrouter";

function KeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 rounded-xl glass border-white/[0.08] h-11 font-mono text-sm"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterModel, setOpenrouterModel] = useState("deepseek/deepseek-v4-flash");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setProvider(s.provider ?? "openrouter");
        setOpenaiKey(s.openaiApiKey ?? "");
        setOpenrouterKey(s.openrouterApiKey ?? "");
        setOpenrouterModel(s.openrouterModel ?? "deepseek/deepseek-v4-flash");
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        openaiApiKey: openaiKey,
        openrouterApiKey: openrouterKey,
        openrouterModel,
      }),
    });
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure AI provider and API credentials
        </p>
      </div>

      <div className="glass rounded-2xl p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20">
            <SlidersHorizontal className="h-4 w-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">AI Provider</h2>
            <p className="text-[11px] text-muted-foreground">
              Used for generating new video concepts in the pipeline
            </p>
          </div>
        </div>

        {/* Provider toggle */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Active Provider</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["openai", "openrouter"] as Provider[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`h-11 rounded-xl text-sm font-medium transition-all border ${
                  provider === p
                    ? "bg-gradient-to-r from-purple-500 to-indigo-600 border-transparent text-white"
                    : "glass border-white/[0.08] text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "openai" ? "OpenAI (direct)" : "OpenRouter"}
              </button>
            ))}
          </div>
        </div>

        {/* OpenAI section */}
        <div className={`space-y-4 rounded-xl p-4 border transition-all ${provider === "openai" ? "border-purple-500/30 bg-purple-500/5" : "border-white/[0.04] opacity-60"}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">OpenAI — Direct</p>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">API Key</Label>
            <KeyInput
              value={openaiKey}
              onChange={setOpenaiKey}
              placeholder="sk-..."
            />
            <p className="text-[11px] text-muted-foreground">
              Model: <span className="text-foreground/70 font-mono">gpt-4o</span> (fixed)
            </p>
          </div>
        </div>

        {/* OpenRouter section */}
        <div className={`space-y-4 rounded-xl p-4 border transition-all ${provider === "openrouter" ? "border-indigo-500/30 bg-indigo-500/5" : "border-white/[0.04] opacity-60"}`}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">OpenRouter</p>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">API Key</Label>
            <KeyInput
              value={openrouterKey}
              onChange={setOpenrouterKey}
              placeholder="sk-or-v1-..."
            />
            <p className="text-[11px] text-muted-foreground">
              Get your key at{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                openrouter.ai/keys
              </a>
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Model</Label>
            <Select value={openrouterModel} onValueChange={setOpenrouterModel}>
              <SelectTrigger className="rounded-xl glass border-white/[0.08] h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong rounded-xl border-white/[0.08]">
                {OPENROUTER_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="rounded-lg cursor-pointer">
                    <div className="py-0.5">
                      <p className="text-sm font-medium">{m.label}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{m.value}</p>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Save */}
        <Button
          onClick={handleSave}
          disabled={loading}
          className={`w-full rounded-xl h-11 border-0 transition-all duration-300 ${
            saved
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
          }`}
        >
          {saved ? (
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4" /> Saved
            </span>
          ) : loading ? (
            "Saving..."
          ) : (
            "Save Settings"
          )}
        </Button>
      </div>
    </div>
  );
}
