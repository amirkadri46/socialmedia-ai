"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DEFAULT_DOWNLOADER_SETTINGS, type DownloaderSettings } from "@/lib/downloader/types";

export default function DownloaderSettingsPage() {
  const [s, setS] = useState<DownloaderSettings>(DEFAULT_DOWNLOADER_SETTINGS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/downloader/settings").then((r) => r.json()).then(setS).catch(() => {});
  }, []);

  const set = <K extends keyof DownloaderSettings>(k: K, v: DownloaderSettings[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    await fetch("/api/downloader/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).catch(() => {});
    setSaving(false);
    toast.success("Settings saved");
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-2">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Downloader Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Downloads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Preferred quality">
            <Select value={s.quality} onValueChange={(v) => set("quality", v as DownloaderSettings["quality"])}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="best">Best Available</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Concurrent downloads">
            <Select
              value={String(s.concurrentDownloads)}
              onValueChange={(v) => set("concurrentDownloads", Number(v))}
            >
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 5, 10].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Retry count">
            <Select value={String(s.retryCount)} onValueChange={(v) => set("retryCount", Number(v))}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[0, 1, 3, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-center justify-between">
            <Label className="text-muted-foreground">Skip duplicate downloads</Label>
            <Switch checked={s.skipDuplicates} onCheckedChange={(v) => set("skipDuplicates", v)} />
          </div>

          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>

          <p className="text-[11px] text-muted-foreground">
            Instagram cookies are configured in{" "}
            <Link href="/settings" className="underline">Settings → Clipping</Link>{" "}
            (yt-dlp Cookies section).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
