"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Eye, EyeOff, Check, Video, Mail, Scissors, Share2, Cpu, Keyboard, RotateCcw, Loader2,
} from "lucide-react";
import {
  SHORTCUT_ACTIONS, DEFAULT_SHORTCUTS, resolveShortcuts, eventToCombo, formatCombo,
  type EditorShortcuts, type ShortcutAction,
} from "@/lib/clip/shortcuts";

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

const SECTIONS = [
  { id: "ai", label: "AI Provider", icon: Cpu },
  { id: "gemini", label: "Gemini", icon: Video },
  { id: "outreach", label: "Outreach", icon: Mail },
  { id: "clipping", label: "Clipping", icon: Scissors },
  { id: "editor", label: "Editor & Shortcuts", icon: Keyboard },
  { id: "social", label: "Social Publishing", icon: Share2 },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

function KeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono"
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Capture a key combo for an editor shortcut.
function ShortcutCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setListening(false); return; }
      const combo = eventToCombo(e);
      if (!combo || ["mod", "shift", "alt", "mod+shift", "mod+alt"].includes(combo)) return; // modifier-only
      onChange(combo);
      setListening(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, onChange]);
  return (
    <Button
      type="button"
      variant={listening ? "secondary" : "outline"}
      size="sm"
      className="min-w-32 font-mono"
      onClick={() => setListening(true)}
    >
      {listening ? "Press keys…" : formatCombo(value)}
    </Button>
  );
}

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>("ai");
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openrouterModel, setOpenrouterModel] = useState("deepseek/deepseek-v4-flash");
  const [geminiModel, setGeminiModel] = useState("gemini-2.0-flash");
  const [apifyToken, setApifyToken] = useState("");
  const [linkedinCharLimit, setLinkedinCharLimit] = useState(200);
  const [emailLengthGuidance, setEmailLengthGuidance] = useState("Aim for 80–130 words. Conversational and direct. No self-introduction opener.");
  const [whatsappCharLimit, setWhatsappCharLimit] = useState(600);
  const [senderName, setSenderName] = useState("");
  const [defaultLocationLabel, setDefaultLocationLabel] = useState("");
  // Clipping
  const [transcriptionProvider, setTranscriptionProvider] = useState<"deepgram" | "assemblyai" | "local">("deepgram");
  const [deepgramApiKey, setDeepgramApiKey] = useState("");
  const [assemblyaiApiKey, setAssemblyaiApiKey] = useState("");
  const [defaultCaptionPreset, setDefaultCaptionPreset] = useState("Karaoke");
  const [defaultAspectRatio, setDefaultAspectRatio] = useState("9:16");
  const [defaultClipLength, setDefaultClipLength] = useState("Auto (0-3m)");
  const [ytDlpCookiesBrowser, setYtDlpCookiesBrowser] = useState("");
  const [ytDlpCookiesText, setYtDlpCookiesText] = useState("");
  // Editor
  const [shortcuts, setShortcuts] = useState<EditorShortcuts>(DEFAULT_SHORTCUTS);
  // Social
  const [metaAppId, setMetaAppId] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [enableSocialPublish, setEnableSocialPublish] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load settings");
        return r.json();
      })
      .then((s) => {
        setProvider(s.provider ?? "openrouter");
        setOpenaiKey(s.openaiApiKey ?? "");
        setOpenrouterKey(s.openrouterApiKey ?? "");
        setOpenrouterModel(s.openrouterModel ?? "deepseek/deepseek-v4-flash");
        setGeminiModel(s.geminiModel ?? "gemini-2.0-flash");
        setApifyToken(s.apifyApiToken ?? "");
        setLinkedinCharLimit(s.linkedinCharLimit ?? 200);
        setEmailLengthGuidance(s.emailLengthGuidance ?? "Aim for 80–130 words. Conversational and direct. No self-introduction opener.");
        setWhatsappCharLimit(s.whatsappCharLimit ?? 600);
        setSenderName(s.senderName ?? "");
        setDefaultLocationLabel(s.defaultLocationLabel ?? "");
        setTranscriptionProvider(s.transcriptionProvider ?? "deepgram");
        setDeepgramApiKey(s.deepgramApiKey ?? "");
        setAssemblyaiApiKey(s.assemblyaiApiKey ?? "");
        setDefaultCaptionPreset(s.defaultCaptionPreset ?? "Karaoke");
        setDefaultAspectRatio(s.defaultAspectRatio ?? "9:16");
        setDefaultClipLength(s.defaultClipLength ?? "Auto (0-3m)");
        setYtDlpCookiesBrowser(s.ytDlpCookiesBrowser ?? "");
        setYtDlpCookiesText(s.ytDlpCookiesText ?? "");
        setShortcuts(resolveShortcuts(s.editorShortcuts));
        setMetaAppId(s.metaAppId ?? "");
        setMetaAppSecret(s.metaAppSecret ?? "");
        setEnableSocialPublish(!!s.enableSocialPublish);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider, openaiApiKey: openaiKey, openrouterApiKey: openrouterKey, openrouterModel, geminiModel,
          apifyApiToken: apifyToken, linkedinCharLimit, emailLengthGuidance,
          whatsappCharLimit, senderName, defaultLocationLabel,
          transcriptionProvider, deepgramApiKey, assemblyaiApiKey,
          defaultCaptionPreset, defaultAspectRatio, defaultClipLength, ytDlpCookiesBrowser, ytDlpCookiesText,
          editorShortcuts: shortcuts,
          metaAppId, metaAppSecret, enableSocialPublish,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save settings");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert("Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const setShortcut = (id: ShortcutAction, combo: string) => setShortcuts((s) => ({ ...s, [id]: combo }));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure providers, credentials, and the clip editor.</p>
        </div>
        <Button onClick={handleSave} disabled={loading} className="min-w-32">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? "Saved" : loading ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="flex gap-6">
        {/* Left section nav */}
        <nav className="sticky top-6 h-fit w-52 shrink-0 space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                active === s.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <s.icon className="h-4 w-4" />
              {s.label}
            </button>
          ))}
        </nav>

        {/* Right content */}
        <div className="min-w-0 flex-1 space-y-6">
          {active === "ai" && (
            <Card>
              <CardHeader>
                <CardTitle>AI Provider</CardTitle>
                <CardDescription>Used for generating new video concepts and outreach drafts.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <Field label="Active provider">
                  <div className="grid grid-cols-2 gap-2">
                    {(["openai", "openrouter"] as Provider[]).map((p) => (
                      <Button key={p} type="button" variant={provider === p ? "default" : "outline"} onClick={() => setProvider(p)}>
                        {p === "openai" ? "OpenAI (direct)" : "OpenRouter"}
                      </Button>
                    ))}
                  </div>
                </Field>

                <div className={`space-y-4 rounded-lg border p-4 ${provider === "openai" ? "" : "opacity-60"}`}>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">OpenAI — Direct</p>
                  <Field label="API Key" hint={<>Model: <span className="font-mono text-foreground/70">gpt-4o</span> (fixed)</>}>
                    <KeyInput value={openaiKey} onChange={setOpenaiKey} placeholder="sk-..." />
                  </Field>
                </div>

                <div className={`space-y-4 rounded-lg border p-4 ${provider === "openrouter" ? "" : "opacity-60"}`}>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">OpenRouter</p>
                  <Field label="API Key" hint={<>Get your key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">openrouter.ai/keys</a></>}>
                    <KeyInput value={openrouterKey} onChange={setOpenrouterKey} placeholder="sk-or-v1-..." />
                  </Field>
                  <Field label="Model">
                    <Select value={openrouterModel} onValueChange={setOpenrouterModel}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OPENROUTER_MODELS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            <div><p className="text-sm font-medium">{m.label}</p><p className="font-mono text-[11px] text-muted-foreground">{m.value}</p></div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </CardContent>
            </Card>
          )}

          {active === "gemini" && (
            <Card>
              <CardHeader>
                <CardTitle>Gemini Model</CardTitle>
                <CardDescription>Used for video analysis. Switch if you hit rate limits or errors.</CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={geminiModel} onValueChange={setGeminiModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GEMINI_MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <div><p className="text-sm font-medium">{m.label}</p><p className="text-[11px] text-muted-foreground">{m.note}</p></div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          {active === "outreach" && (
            <Card>
              <CardHeader>
                <CardTitle>Outreach</CardTitle>
                <CardDescription>Settings for the Prospects drafting workstation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="LinkedIn DM char limit" hint="Connection messages max at 300 chars; standard DMs vary.">
                    <Input type="number" value={linkedinCharLimit} onChange={(e) => setLinkedinCharLimit(Number(e.target.value))} min={50} max={500} />
                  </Field>
                  <Field label="Drafting model" hint="Controlled by the AI Provider setting.">
                    <div className="flex h-9 items-center rounded-md border px-3">
                      <span className="font-mono text-sm text-muted-foreground">gpt-4o / OpenRouter model</span>
                    </div>
                  </Field>
                </div>
                <Field label="Email length guidance" hint="Injected into the prompt as a length/style reminder.">
                  <Textarea value={emailLengthGuidance} onChange={(e) => setEmailLengthGuidance(e.target.value)} rows={2} className="resize-none" />
                </Field>
                <Field label="Apify API token" hint="Used to scrape LinkedIn profiles by URL. Not required for CSV import.">
                  <KeyInput value={apifyToken} onChange={setApifyToken} placeholder="apify_api_..." />
                </Field>

                <div className="border-t pt-6">
                  <p className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Lead Intelligence (Google Maps leads)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="WhatsApp char limit" hint="Soft target length for the generated WhatsApp message.">
                      <Input type="number" value={whatsappCharLimit} onChange={(e) => setWhatsappCharLimit(Number(e.target.value))} min={100} max={2000} />
                    </Field>
                    <Field label="Sender name" hint="Used to sign generated emails (e.g. “Aamir”).">
                      <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Aamir" />
                    </Field>
                  </div>
                  <div className="mt-4">
                    <Field label="Default location label" hint="Optional fallback for {location} when a lead has no location.">
                      <Input value={defaultLocationLabel} onChange={(e) => setDefaultLocationLabel(e.target.value)} placeholder="your area" />
                    </Field>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {active === "clipping" && (
            <Card>
              <CardHeader>
                <CardTitle>Clipping</CardTitle>
                <CardDescription>Transcription provider and defaults for the long-video → clips pipeline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-md border bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
                  Requires <span className="font-mono text-foreground/70">yt-dlp</span> and a transcription key. Install yt-dlp once
                  (brew / pip / winget) or set <span className="font-mono text-foreground/70">YT_DLP_PATH</span>. ffmpeg is bundled.
                </div>
                <Field
                  label="YouTube cookies browser (local only)"
                  hint="Reads cookies from a browser installed on the SAME machine. Works locally, but NOT on Railway/servers (no browser there) — use the cookies.txt box below for hosted deploys."
                >
                  <Select value={ytDlpCookiesBrowser || "none"} onValueChange={(v) => setYtDlpCookiesBrowser(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (no cookies)</SelectItem>
                      <SelectItem value="chrome">Chrome</SelectItem>
                      <SelectItem value="firefox">Firefox</SelectItem>
                      <SelectItem value="edge">Edge</SelectItem>
                      <SelectItem value="brave">Brave</SelectItem>
                      <SelectItem value="chromium">Chromium</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="YouTube cookies.txt (works on Railway)"
                  hint={<>Fixes “Sign in to confirm you’re not a bot” on hosted deploys. Export with a browser extension like <span className="font-mono text-foreground/70">Get cookies.txt LOCALLY</span> while logged into YouTube, then paste the file’s contents here. Takes priority over the browser option above. Treat this like a password — anyone with it can act as your YouTube login.</>}
                >
                  <Textarea
                    value={ytDlpCookiesText}
                    onChange={(e) => setYtDlpCookiesText(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\t..."}
                    className="resize-y font-mono text-[11px]"
                  />
                </Field>
                <Field label="Transcription provider">
                  <div className="grid grid-cols-3 gap-2">
                    {(["deepgram", "assemblyai", "local"] as const).map((p) => (
                      <Button key={p} type="button" variant={transcriptionProvider === p ? "default" : "outline"} className="capitalize" onClick={() => setTranscriptionProvider(p)}>
                        {p}
                      </Button>
                    ))}
                  </div>
                </Field>
                <Field label="Deepgram API key" hint={<>Recommended — word-level timestamps in one call. Get a key at <a href="https://deepgram.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">deepgram.com</a>.</>}>
                  <KeyInput value={deepgramApiKey} onChange={setDeepgramApiKey} placeholder="dg_..." />
                </Field>
                <Field label="AssemblyAI API key (alternative)">
                  <KeyInput value={assemblyaiApiKey} onChange={setAssemblyaiApiKey} placeholder="..." />
                </Field>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Default caption preset"><Input value={defaultCaptionPreset} onChange={(e) => setDefaultCaptionPreset(e.target.value)} /></Field>
                  <Field label="Default aspect"><Input value={defaultAspectRatio} onChange={(e) => setDefaultAspectRatio(e.target.value)} /></Field>
                  <Field label="Default length"><Input value={defaultClipLength} onChange={(e) => setDefaultClipLength(e.target.value)} /></Field>
                </div>
              </CardContent>
            </Card>
          )}

          {active === "editor" && (
            <Card>
              <CardHeader>
                <CardTitle>Editor & Shortcuts</CardTitle>
                <CardDescription>Keyboard shortcuts for the clip editor toolbar and transport. Click a key to rebind; Esc cancels.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShortcuts({ ...DEFAULT_SHORTCUTS })}>
                    <RotateCcw className="h-4 w-4" /> Reset to defaults
                  </Button>
                </div>
                <div className="divide-y rounded-md border">
                  {SHORTCUT_ACTIONS.map((a) => (
                    <div key={a.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm">{a.label}</span>
                      <ShortcutCapture value={shortcuts[a.id]} onChange={(c) => setShortcut(a.id, c)} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {active === "social" && (
            <Card>
              <CardHeader>
                <CardTitle>Social Publishing</CardTitle>
                <CardDescription>Meta (Instagram) credentials for connecting and publishing clips.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-1 rounded-md border bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
                  <p>In Meta Developer Console → your app → <span className="font-medium text-foreground/70">API setup with Instagram login</span>:</p>
                  <ol className="list-inside list-decimal space-y-0.5 pl-1">
                    <li>Add required messaging permissions</li>
                    <li>Use an <span className="font-medium text-foreground/70">HTTPS</span> redirect URI (deployed URL or <span className="font-mono text-foreground/70">ngrok</span>), set <span className="font-mono text-foreground/70">APP_URL</span>, then add <span className="font-mono text-foreground/70">{`<url>`}/api/clip/social/callback</span></li>
                    <li>Copy the <span className="font-medium text-foreground/70">Instagram App ID</span> + <span className="font-medium text-foreground/70">Secret</span> (not the Facebook ones)</li>
                  </ol>
                </div>
                <Field label="Instagram App ID" hint="From Meta Developer Console → API setup with Instagram login.">
                  <Input value={metaAppId} onChange={(e) => setMetaAppId(e.target.value)} placeholder="2008737423349466" className="font-mono" />
                </Field>
                <Field label="Instagram App Secret" hint="From the same page — click Show to reveal it.">
                  <KeyInput value={metaAppSecret} onChange={setMetaAppSecret} placeholder="..." />
                </Field>
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Enable live publishing</p>
                    <p className="text-[11px] text-muted-foreground">Off = schedule/draft only. Turn on after Meta App Review.</p>
                  </div>
                  <Switch checked={enableSocialPublish} onCheckedChange={setEnableSocialPublish} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
