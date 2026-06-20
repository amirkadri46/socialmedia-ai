"use client";

import { useEffect, useState } from "react";
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
import {
  Calendar,
  Loader2,
  Send,
  Sparkles,
  Check,
  Plus,
  Instagram,
} from "lucide-react";
import type { Clip } from "@/lib/types";

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
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    fetch("/api/clip/social/accounts")
      .then((r) => r.json())
      .then((a: AccountLite[]) => {
        setAccounts(a);
        setSelected(a.map((x) => x.id));
      })
      .catch(() => {});
  }, []);

  // Auto-generate an initial caption if none exists.
  useEffect(() => {
    if (!clip.caption) void regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/clip/social/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId: clip.id, tone, format, hashtags }),
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

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(publishNow: boolean) {
    if (selected.length === 0) {
      setResult("Select at least one account.");
      return;
    }
    setSubmitting(true);
    setResult("");
    try {
      const res = await fetch("/api/clip/social/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId: clip.id,
          accountIds: selected,
          caption,
          scheduledFor: publishNow ? undefined : when || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(data.error || "Failed.");
      } else {
        const statuses = (data.results || []).map(
          (r: { post: { status: string; error?: string } }) => r.post.error || r.post.status
        );
        setResult(
          publishNow
            ? `Publish: ${statuses.join(", ")}`
            : `Scheduled for ${when || "next slot"}.`
        );
      }
    } catch {
      setResult("Request failed.");
    } finally {
      setSubmitting(false);
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Accounts</p>
            {accounts.length === 0 && (
              <a
                href="/clip/social"
                className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-4 w-4" /> Connect an account
              </a>
            )}
            {accounts.map((a) => {
              const isSel = selected.includes(a.id);
              return (
                <Button
                  key={a.id}
                  variant="outline"
                  onClick={() => toggle(a.id)}
                  className={`w-full justify-start gap-2 ${
                    isSel ? "border-primary bg-primary/10" : ""
                  }`}
                >
                  <Instagram className="h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate text-sm">{a.displayName || a.username}</span>
                  {isSel && <Check className="h-4 w-4 text-primary" />}
                </Button>
              );
            })}
          </div>

          {/* Caption + controls */}
          <div className="space-y-3">
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
                onClick={regenerate}
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
                disabled={submitting}
                variant="outline"
                className="ml-auto"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Schedule
              </Button>
              <Button
                onClick={() => submit(true)}
                disabled={submitting}
              >
                <Send className="h-4 w-4" /> Publish now
              </Button>
            </div>

            {result && <p className="text-xs text-muted-foreground">{result}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
