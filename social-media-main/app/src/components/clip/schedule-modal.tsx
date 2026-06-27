"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Calendar,
  Loader2,
  Send,
  Sparkles,
  Check,
  Plus,
  Instagram,
  LayoutTemplate,
} from "lucide-react";
import { CaptionTemplatesManager } from "@/components/clip/caption-templates-manager";
import type { Clip, CaptionPromptTemplate } from "@/lib/types";

const NO_TEMPLATE = "__none__";
const LAST_TEMPLATE_KEY = "clip:lastCaptionTemplate";

interface AccountLite {
  id: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
}

const TONES = ["Bold", "Casual", "Inspiring", "Witty", "Educational"];
const FORMATS = ["Hook + payoff", "Listicle", "Question-led", "Story"];

export function ScheduleModal({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState(clip.caption || "");
  const [generating, setGenerating] = useState(false);
  const [tone, setTone] = useState("");
  const [format, setFormat] = useState("");
  const [hashtags, setHashtags] = useState(true);
  const [when, setWhen] = useState("");
  const [submitting, setSubmitting] = useState<null | "schedule" | "publish">(null);
  const [result, setResult] = useState<string>("");
  const [templates, setTemplates] = useState<CaptionPromptTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(NO_TEMPLATE);
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    fetch("/api/clip/social/accounts")
      .then((r) => r.json())
      .then((a: AccountLite[]) => {
        setAccounts(a);
        setSelected(a.map((x) => x.id));
      })
      .catch(() => {});
  }, []);

  // Load templates and restore the last-used one (per the goal: same creator, same template
  // across clips without re-picking it every time).
  useEffect(() => {
    let restored = NO_TEMPLATE;
    fetch("/api/clip/social/caption-templates")
      .then((r) => r.json())
      .then((list: CaptionPromptTemplate[]) => {
        setTemplates(list);
        const last = typeof window !== "undefined" ? localStorage.getItem(LAST_TEMPLATE_KEY) : null;
        if (last && list.some((t) => t.id === last)) {
          restored = last;
          setTemplateId(last);
        }
      })
      .catch(() => {})
      .finally(() => {
        // Auto-generate an initial caption once, only after templates resolve, so the restored
        // template is used as the base context (no throwaway no-template generation first).
        if (!clip.caption) void regenerate(restored);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerate(useTemplateId: string = templateId) {
    setGenerating(true);
    setResult("");
    try {
      const res = await fetch("/api/clip/social/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: clip.id,
          tone,
          format,
          hashtags,
          templateId: useTemplateId !== NO_TEMPLATE ? useTemplateId : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) setCaption(data.caption);
      else setResult(data.error || "Caption generation failed.");
    } catch {
      setResult("Caption generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  // Selecting a template immediately regenerates so the user sees the on-brand caption — the
  // whole point is speed for back-to-back clips from the same creator.
  function selectTemplate(id: string) {
    setTemplateId(id);
    if (typeof window !== "undefined") {
      if (id === NO_TEMPLATE) localStorage.removeItem(LAST_TEMPLATE_KEY);
      else localStorage.setItem(LAST_TEMPLATE_KEY, id);
    }
    void regenerate(id);
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(publishNow: boolean) {
    if (selected.length === 0) {
      setResult("Select at least one account.");
      return;
    }
    // Scheduling requires an explicit date/time. Without one, an absent `scheduledFor`
    // makes the server treat the request as publish-now (which is gated), so the button
    // would silently do nothing while reporting a false "Scheduled" success.
    if (!publishNow && !when) {
      setResult("Pick a date and time to schedule, or use Publish now.");
      return;
    }
    setSubmitting(publishNow ? "publish" : "schedule");
    setResult("");
    try {
      const res = await fetch("/api/clip/social/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: clip.id,
          accountIds: selected,
          caption,
          scheduledFor: publishNow ? undefined : when,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(data.error || "Failed.");
      } else {
        const posts: { status: string; error?: string }[] = (data.results || []).map(
          (r: { post: { status: string; error?: string } }) => r.post
        );
        // Surface real per-account failures (publish gate, missing account, …) instead of
        // claiming success unconditionally.
        const failed = posts.filter((p) => p.status === "failed" || p.error);
        if (failed.length) {
          setResult(failed.map((p) => p.error || p.status).join(", "));
        } else if (publishNow) {
          setResult(`Publish: ${posts.map((p) => p.status).join(", ")}`);
        } else {
          setResult(
            `Scheduled ${posts.length} post${posts.length === 1 ? "" : "s"} for ${new Date(
              when
            ).toLocaleString()}.`
          );
        }
      }
    } catch {
      setResult("Request failed.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule post</DialogTitle>
          <DialogDescription>
            Select accounts and generate a caption. Publishing is gated until your Meta app is approved.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[200px_1fr]">
          {/* Accounts */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Accounts</p>
              {accounts.length > 0 && (
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelected(accounts.map((a) => a.id))}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    All
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    None
                  </button>
                </div>
              )}
            </div>
            {accounts.length === 0 && (
              <Link
                href="/clip/social"
                className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-4 w-4" /> Connect an account
              </Link>
            )}
            {accounts.map((a) => {
              const isSel = selected.includes(a.id);
              return (
                <Button
                  key={a.id}
                  variant="outline"
                  onClick={() => toggle(a.id)}
                  className={`h-auto w-full justify-start gap-2 py-2 ${
                    isSel ? "border-primary bg-primary/10" : ""
                  }`}
                >
                  <Avatar className="h-6 w-6">
                    {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt={a.username} />}
                    <AvatarFallback>
                      <Instagram className="h-3.5 w-3.5" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm">{a.displayName || a.username}</span>
                  {isSel && <Check className="h-4 w-4 text-primary" />}
                </Button>
              );
            })}
            {accounts.length > 0 && (
              <p className="pt-1 text-xs text-muted-foreground">
                Publishing to {selected.length} account{selected.length === 1 ? "" : "s"}
              </p>
            )}
          </div>

          {/* Caption + controls */}
          <div className="space-y-3">
            {/* Caption template: reusable per-creator context, applied as the base for this clip */}
            <div className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Select value={templateId} onValueChange={selectTemplate}>
                <SelectTrigger size="sm" className="w-auto min-w-[160px] flex-1">
                  <SelectValue placeholder="No template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.creator ? ` · ${t.creator}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setManagerOpen(true)}>
                <LayoutTemplate className="h-3.5 w-3.5" /> Templates
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select value={tone || undefined} onValueChange={setTone}>
                <SelectTrigger size="sm" className="w-auto min-w-[90px]">
                  <SelectValue placeholder="Tone" />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={format || undefined} onValueChange={setFormat}>
                <SelectTrigger size="sm" className="w-auto min-w-[120px]">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={hashtags ? "default" : "outline"}
                size="sm"
                onClick={() => setHashtags(!hashtags)}
              >
                # Hashtags
              </Button>
              <Button
                onClick={() => regenerate()}
                disabled={generating}
                variant="outline"
                size="sm"
                className="ml-auto"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Regenerate
              </Button>
            </div>

            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={7}
              placeholder="Your caption…"
            />

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="w-auto [color-scheme:dark]"
                />
              </div>
              <Button
                onClick={() => submit(false)}
                disabled={submitting !== null}
                variant="outline"
                className="ml-auto"
              >
                {submitting === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Schedule
              </Button>
              <Button
                onClick={() => submit(true)}
                disabled={submitting !== null}
              >
                {submitting === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish now
              </Button>
            </div>

            {result && <p className="text-xs text-muted-foreground">{result}</p>}
          </div>
        </div>
      </DialogContent>

      <CaptionTemplatesManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onTemplatesChange={(list) => {
          setTemplates(list);
          // If the selected template was deleted, fall back to "No template".
          setTemplateId((cur) => (cur !== NO_TEMPLATE && !list.some((t) => t.id === cur) ? NO_TEMPLATE : cur));
        }}
        onApply={selectTemplate}
      />
    </Dialog>
  );
}
