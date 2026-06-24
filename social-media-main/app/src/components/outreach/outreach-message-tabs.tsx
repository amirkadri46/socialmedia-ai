"use client";

import { useState } from "react";
import { Copy, Check, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColdCallCard } from "./cold-call-card";
import type { Prospect } from "@/lib/types";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!text}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success(`${label} copied`);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      Copy
    </Button>
  );
}

export function OutreachMessageTabs({
  prospect,
  whatsappLimit,
  onSave,
  onRegenerate,
  regenerating,
}: {
  prospect: Prospect;
  whatsappLimit: number;
  onSave: (updates: Partial<Prospect>) => void;
  onRegenerate: () => void;
  regenerating?: boolean;
}) {
  // Initialised from props; the parent remounts this via `key` when the
  // underlying messages change (e.g. after regenerate), so no effect is needed.
  const [whatsapp, setWhatsapp] = useState(prospect.whatsappMessage ?? "");
  const [email, setEmail] = useState(prospect.emailMessage ?? "");

  const waOver = whatsapp.length > whatsappLimit;

  return (
    <Tabs defaultValue="whatsapp" className="w-full">
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="call">Cold Call</TabsTrigger>
        </TabsList>
        <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={regenerating}>
          {regenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          Regenerate
        </Button>
      </div>

      <TabsContent value="whatsapp" className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className={`text-[11px] tabular-nums ${waOver ? "font-semibold text-red-500" : "text-muted-foreground"}`}>
            {whatsapp.length} / {whatsappLimit}
          </span>
          <CopyButton text={whatsapp} label="WhatsApp message" />
        </div>
        <Textarea
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          onBlur={() => whatsapp !== prospect.whatsappMessage && onSave({ whatsappMessage: whatsapp })}
          rows={6}
          placeholder="WhatsApp message…"
        />
      </TabsContent>

      <TabsContent value="email" className="mt-3 space-y-2">
        <div className="flex items-center justify-end">
          <CopyButton text={email} label="Email" />
        </div>
        <Textarea
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => email !== prospect.emailMessage && onSave({ emailMessage: email })}
          rows={12}
          placeholder="Cold email…"
        />
      </TabsContent>

      <TabsContent value="call" className="mt-3">
        <ColdCallCard notes={prospect.coldCallNotes} />
      </TabsContent>
    </Tabs>
  );
}
