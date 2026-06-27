"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function parseUrls(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
}

export function UrlInputPanel({
  onSubmit,
  loading,
}: {
  onSubmit: (urls: string[]) => void;
  loading: boolean;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const count = parseUrls(text).length;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    e.target.value = "";
  };

  return (
    <div className="space-y-3 pt-4">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "Paste video URLs here, one per line...\n\nhttps://www.youtube.com/shorts/xxxx\nhttps://www.instagram.com/reel/yyyy/"
        }
        className="min-h-[140px] font-mono text-xs"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{count} URLs detected</span>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".txt" hidden onChange={handleFile} />
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload .txt
          </Button>
          <Button
            size="sm"
            disabled={count === 0 || loading}
            onClick={() => onSubmit(parseUrls(text))}
          >
            <Download className="h-4 w-4" /> Add to Queue
          </Button>
        </div>
      </div>
    </div>
  );
}
