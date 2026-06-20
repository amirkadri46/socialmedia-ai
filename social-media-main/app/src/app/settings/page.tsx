"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal, Eye, EyeOff, Check, Video, Mail, Scissors, Share2 } from "lucide-react";

const GEMINI_MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Latest Flash · audio, video, image, text · recommended" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Latest Pro · highest quality · audio, video, image, text" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", note: "Previous Flash · fast & cost-effective · audio, video, image, text" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", note: "Most cost-effective · audio, video, image, text" },
];

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
  const [geminiModel, setGeminiModel] = useState("gemini-2.0-flash");
  const [apifyToken, setApifyToken] = useState("");
  const [linkedinCharLimit, setLinkedinCharLimit] = useState(200);
  const [emailLengthGuidance, setEmailLengthGuidance] = useState("Aim for 80–130 words. Conversational and direct. No self-introduction opener.");
  // Clipping
  const [transcriptionProvider, setTranscriptionProvider] = useState<"deepgram" | "assemblyai" | "local">("deepgram");
  const [deepgramApiKey, setDeepgramApiKey] = useState("");
  const [assemblyaiApiKey, setAssemblyaiApiKey] = useState("");
  const [defaultCaptionPreset, setDefaultCaptionPreset] = useState("Karaoke");
  const [defaultAspectRatio, setDefaultAspectRatio] = useState("9:16");
  const [defaultClipLength, setDefaultClipLength] = useState("Auto (0-3m)");
  // Social
  const [metaAppId, setMetaAppId] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [enableSocialPublish, setEnableSocialPublish] = useState(false);
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
        setGeminiModel(s.geminiModel ?? "gemini-2.0-flash");
        setApifyToken(s.apifyApiToken ?? "");
        setLinkedinCharLimit(s.linkedinCharLimit ?? 200);
        setEmailLengthGuidance(s.emailLengthGuidance ?? "Aim for 80–130 words. Conversational and direct. No self-introduction opener.");
        setTranscriptionProvider(s.transcriptionProvider ?? "deepgram");
        setDeepgramApiKey(s.deepgramApiKey ?? "");
        setAssemblyaiApiKey(s.assemblyaiApiKey ?? "");
        setDefaultCaptionPreset(s.defaultCaptionPreset ?? "Karaoke");
        setDefaultAspectRatio(s.defaultAspectRatio ?? "9:16");
        setDefaultClipLength(s.defaultClipLength ?? "Auto (0-3m)");
        setMetaAppId(s.metaAppId ?? "");
        setMetaAppSecret(s.metaAppSecret ?? "");
        setEnableSocialPublish(!!s.enableSocialPublish);
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
        geminiModel,
        apifyApiToken: apifyToken,
        linkedinCharLimit,
        emailLengthGuidance,
        transcriptionProvider,
        deepgramApiKey,
        assemblyaiApiKey,
        defaultCaptionPreset,
        defaultAspectRatio,
        defaultClipLength,
        metaAppId,
        metaAppSecret,
        enableSocialPublish,
      }),
    });
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
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

      </div>

      {/* Gemini model selector */}
      <div className="glass rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/20">
            <Video className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Gemini Model</h2>
            <p className="text-[11px] text-muted-foreground">
              Used for video analysis. Switch if you hit rate limits or errors.
            </p>
          </div>
        </div>

        <Select value={geminiModel} onValueChange={setGeminiModel}>
          <SelectTrigger className="rounded-xl glass border-white/[0.08] h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="glass-strong rounded-xl border-white/[0.08]">
            {GEMINI_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="rounded-lg cursor-pointer">
                <div className="py-0.5">
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground">{m.note}</p>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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

      {/* Outreach settings */}
      <div className="glass rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/20">
            <Mail className="h-4 w-4 text-green-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Outreach</h2>
            <p className="text-[11px] text-muted-foreground">
              Settings for the Prospects drafting workstation
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">LinkedIn DM Char Limit</Label>
            <Input
              type="number"
              value={linkedinCharLimit}
              onChange={(e) => setLinkedinCharLimit(Number(e.target.value))}
              min={50}
              max={500}
              className="rounded-xl glass border-white/[0.08] h-11"
            />
            <p className="text-[11px] text-muted-foreground">LinkedIn connection messages max at 300 chars; standard DMs vary.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Drafting Model</Label>
            <div className="rounded-xl glass border border-white/[0.08] h-11 flex items-center px-3">
              <span className="text-sm font-mono text-muted-foreground">
                gpt-4o (OpenAI) or configured OpenRouter model
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">Controlled by the AI Provider setting above.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Email Length Guidance</Label>
          <Textarea
            value={emailLengthGuidance}
            onChange={(e) => setEmailLengthGuidance(e.target.value)}
            rows={2}
            className="rounded-xl glass border-white/[0.08] resize-none text-sm"
          />
          <p className="text-[11px] text-muted-foreground">Injected into the GPT-4o prompt as a length/style reminder.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Apify API Token (for Phase 2 URL scraping)</Label>
          <KeyInput
            value={apifyToken}
            onChange={setApifyToken}
            placeholder="apify_api_..."
          />
          <p className="text-[11px] text-muted-foreground">Used to scrape LinkedIn profiles by URL. Not required for CSV import.</p>
        </div>

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

      {/* Clipping settings */}
      <div className="glass rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20 border border-purple-500/20">
            <Scissors className="h-4 w-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Clipping</h2>
            <p className="text-[11px] text-muted-foreground">
              Transcription provider for the long-video → clips pipeline.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] text-muted-foreground">
          Requires <span className="font-mono text-foreground/70">yt-dlp</span> and a transcription key.
          Install yt-dlp once (brew install yt-dlp · pip install yt-dlp · winget install yt-dlp) or set{" "}
          <span className="font-mono text-foreground/70">YT_DLP_PATH</span>. ffmpeg is bundled.
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Transcription Provider</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["deepgram", "assemblyai", "local"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTranscriptionProvider(p)}
                className={`h-11 rounded-xl text-sm font-medium capitalize transition-all border ${
                  transcriptionProvider === p
                    ? "bg-gradient-to-r from-purple-500 to-indigo-600 border-transparent text-white"
                    : "glass border-white/[0.08] text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Deepgram API Key</Label>
          <KeyInput value={deepgramApiKey} onChange={setDeepgramApiKey} placeholder="dg_..." />
          <p className="text-[11px] text-muted-foreground">
            Recommended — word-level timestamps in one call. Get a key at{" "}
            <a href="https://deepgram.com" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300">deepgram.com</a>.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">AssemblyAI API Key (alternative)</Label>
          <KeyInput value={assemblyaiApiKey} onChange={setAssemblyaiApiKey} placeholder="..." />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Default Caption Preset</Label>
            <Input value={defaultCaptionPreset} onChange={(e) => setDefaultCaptionPreset(e.target.value)} className="rounded-xl glass border-white/[0.08] h-11" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Default Aspect</Label>
            <Input value={defaultAspectRatio} onChange={(e) => setDefaultAspectRatio(e.target.value)} className="rounded-xl glass border-white/[0.08] h-11" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Default Length</Label>
            <Input value={defaultClipLength} onChange={(e) => setDefaultClipLength(e.target.value)} className="rounded-xl glass border-white/[0.08] h-11" />
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={loading}
          className={`w-full rounded-xl h-11 border-0 transition-all duration-300 ${
            saved ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
          }`}
        >
          {saved ? <span className="flex items-center gap-2"><Check className="h-4 w-4" /> Saved</span> : loading ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      {/* Social publishing settings */}
      <div className="glass rounded-2xl p-6 space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500/20 to-rose-500/20 border border-pink-500/20">
            <Share2 className="h-4 w-4 text-pink-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Social Publishing</h2>
            <p className="text-[11px] text-muted-foreground">
              Meta (Instagram) credentials for connecting and publishing clips.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] text-muted-foreground space-y-1">
          <p>In Meta Developer Console → your app → <span className="font-medium text-foreground/70">API setup with Instagram login</span>:</p>
          <ol className="list-decimal list-inside space-y-0.5 pl-1">
            <li>Add required messaging permissions</li>
            <li>Meta requires an <span className="font-medium text-foreground/70">HTTPS</span> redirect URI — use your deployed URL (or <span className="font-mono text-foreground/70">ngrok http 3000</span> locally), set <span className="font-mono text-foreground/70">APP_URL</span> to it, then add redirect URI: <span className="font-mono text-foreground/70">{`<your-https-url>`}/api/clip/social/callback</span></li>
            <li>Copy the <span className="font-medium text-foreground/70">Instagram App ID</span> and <span className="font-medium text-foreground/70">Instagram App Secret</span> from that page (different from any Facebook credentials)</li>
          </ol>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Instagram App ID</Label>
          <Input value={metaAppId} onChange={(e) => setMetaAppId(e.target.value)} placeholder="2008737423349466" className="rounded-xl glass border-white/[0.08] h-11 font-mono text-sm" />
          <p className="text-[11px] text-muted-foreground">From Meta Developer Console → API setup with Instagram login (not the Facebook App ID).</p>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Instagram App Secret</Label>
          <KeyInput value={metaAppSecret} onChange={setMetaAppSecret} placeholder="..." />
          <p className="text-[11px] text-muted-foreground">From the same page — click Show to reveal it.</p>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 border border-white/[0.06]">
          <div>
            <p className="text-sm font-medium">Enable live publishing</p>
            <p className="text-[11px] text-muted-foreground">Off = schedule/draft only. Turn on after Meta App Review.</p>
          </div>
          <button
            type="button"
            onClick={() => setEnableSocialPublish(!enableSocialPublish)}
            className={`relative h-6 w-11 rounded-full transition-colors ${enableSocialPublish ? "bg-pink-500" : "bg-white/10"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enableSocialPublish ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>

        <Button
          onClick={handleSave}
          disabled={loading}
          className={`w-full rounded-xl h-11 border-0 transition-all duration-300 ${
            saved ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700"
          }`}
        >
          {saved ? <span className="flex items-center gap-2"><Check className="h-4 w-4" /> Saved</span> : loading ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
