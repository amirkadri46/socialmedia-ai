"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Share2, Instagram, Plus, Trash2, Loader2, AlertTriangle } from "lucide-react";

function formatConnected(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

interface AccountLite {
  id: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  connectedAt: string;
}

export default function SocialPage() {
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishEnabled, setPublishEnabled] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  function load() {
    fetch("/api/clip/social/accounts")
      .then((r) => r.json())
      .then((a: AccountLite[]) => setAccounts(a))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => setPublishEnabled(!!s.enableSocialPublish))
      .catch(() => {});

    const sp = new URLSearchParams(window.location.search);
    if (sp.get("connected")) {
      const handle = sp.get("connected");
      setNotice(
        sp.get("reconnected")
          ? { kind: "ok", msg: `Reconnected @${handle} (token refreshed)` }
          : { kind: "ok", msg: `Connected @${handle}` }
      );
    }
    if (sp.get("error")) setNotice({ kind: "err", msg: decodeURIComponent(sp.get("error")!) });
    if (sp.get("connected") || sp.get("error")) {
      window.history.replaceState({}, "", "/clip/social");
    }
  }, []);

  async function disconnect(id: string) {
    await fetch("/api/clip/social/accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-16">
      <div>
        <div className="flex items-center gap-2">
          <Share2 className="h-5 w-5 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Social Accounts</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Instagram to schedule and publish your clips.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.kind === "ok"
              ? "bg-muted text-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {notice.msg}
        </div>
      )}

      {/* Publish-gating notice */}
      {!publishEnabled && (
        <div className="flex items-start gap-3 rounded-xl border bg-muted px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Publishing is gated.</span> Connecting and scheduling work now, but live publishing stays off until you create a Meta app, complete App Review, and toggle{" "}
            <Link href="/settings" className="text-foreground underline hover:no-underline">enableSocialPublish</Link> in Settings (PRD §2.4).
          </div>
        </div>
      )}

      <Card>
        <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Connected accounts{!loading && accounts.length > 0 ? ` (${accounts.length})` : ""}
          </h2>
          <div className="flex flex-col items-end gap-1">
            <Button asChild variant="outline">
              <a href="/api/clip/social/connect?platform=instagram">
                <Plus className="h-4 w-4" /> Add account
              </a>
            </Button>
            <p className="max-w-60 text-right text-[11px] leading-tight text-muted-foreground">
              You&apos;ll be asked to log in — switch to the Instagram account you want to add before authorizing.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex h-20 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No accounts connected yet.
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3"
              >
                <Avatar className="h-9 w-9">
                  {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt={a.username} />}
                  <AvatarFallback>
                    <Instagram className="h-4 w-4 text-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.displayName || a.username}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{a.username} · Instagram
                    {a.connectedAt && ` · Connected ${formatConnected(a.connectedAt)}`}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      title="Disconnect"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect @{a.username}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You can reconnect anytime.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => disconnect(a.id)}>
                        Disconnect
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}
        </CardContent>
      </Card>
    </div>
  );
}
