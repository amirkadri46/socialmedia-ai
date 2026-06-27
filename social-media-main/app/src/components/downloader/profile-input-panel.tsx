"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const LIMITS: Record<string, number | undefined> = {
  all: undefined,
  "10": 10,
  "25": 25,
  "50": 50,
  "100": 100,
};

function platformOf(url: string): "YouTube" | "Instagram" | null {
  if (/youtube\.com|youtu\.be/i.test(url)) return "YouTube";
  if (/instagram\.com/i.test(url)) return "Instagram";
  return null;
}

export function ProfileInputPanel({
  onSubmit,
  loading,
}: {
  onSubmit: (url: string, limit?: number) => void;
  loading: boolean;
}) {
  const [url, setUrl] = useState("");
  const [limitKey, setLimitKey] = useState("all");
  const [custom, setCustom] = useState("");
  const platform = platformOf(url);

  const resolvedLimit =
    limitKey === "custom" ? Number(custom) || undefined : LIMITS[limitKey];

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/@creator  or  https://www.instagram.com/creator/"
        />
        {platform && (
          <Badge variant="secondary" className="shrink-0">{platform}</Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select value={limitKey} onValueChange={setLimitKey}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All videos</SelectItem>
            <SelectItem value="10">Latest 10</SelectItem>
            <SelectItem value="25">Latest 25</SelectItem>
            <SelectItem value="50">Latest 50</SelectItem>
            <SelectItem value="100">Latest 100</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        {limitKey === "custom" && (
          <Input
            type="number"
            min={1}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Count"
            className="w-[100px]"
          />
        )}
        <Button
          className="ml-auto"
          disabled={!url.trim() || loading}
          onClick={() => onSubmit(url.trim(), resolvedLimit)}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Scraping profile...
            </>
          ) : (
            <>
              <Search className="h-4 w-4" /> Scrape &amp; Add to Queue
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
