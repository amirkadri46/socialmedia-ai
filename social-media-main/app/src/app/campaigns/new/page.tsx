"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { VideoSelector } from "@/components/campaigns/video-selector";
import { AccountSelector } from "@/components/campaigns/account-selector";
import { ScheduleRuleEditor } from "@/components/campaigns/schedule-rule-editor";
import { CampaignPreviewCard } from "@/components/campaigns/campaign-preview-card";
import type { ScheduleRule } from "@/lib/db/types";

const STEPS = ["Details", "Videos", "Accounts", "Schedule & Publish"];

const DEFAULT_RULE: ScheduleRule = {
  frequencyHours: 3,
  windowStart: "09:00",
  windowEnd: "22:00",
  timezone: "Asia/Kolkata",
  randomizeMinutes: 0,
  startDate: new Date().toISOString().split("T")[0],
};

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [captionTemplate, setCaptionTemplate] = useState("");
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [rule, setRule] = useState<ScheduleRule>(DEFAULT_RULE);

  const [createdId, setCreatedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canNext = [
    name.trim().length > 0,
    selectedVideoIds.length > 0,
    selectedAccountIds.length > 0,
    true,
  ][step];

  // For preview card we need a campaign id — create a temp one on step 3→4 transition
  const handleNextFromAccounts = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          captionPromptTemplate: captionTemplate.trim() || undefined,
          scheduleRule: rule,
          timezone: rule.timezone,
        }),
      });
      const campaign = await res.json();
      setCreatedId(campaign.id);
      // Associate videos & accounts eagerly so preview has real data
      for (let i = 0; i < selectedVideoIds.length; i++) {
        await fetch(`/api/campaigns/${campaign.id}/videos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: selectedVideoIds[i], position: i }),
        });
      }
      for (const accountId of selectedAccountIds) {
        await fetch(`/api/campaigns/${campaign.id}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        });
      }
      setStep(3);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async (publish: boolean) => {
    if (!createdId) return;
    setSaving(true);
    try {
      if (publish) {
        await fetch(`/api/campaigns/${createdId}/publish`, { method: "POST" });
      }
      router.push("/campaigns");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                i < step
                  ? "bg-green-600 text-white"
                  : i === step
                  ? "bg-purple-600 text-white"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-sm ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="text-zinc-700 mx-1">›</span>}
          </div>
        ))}
      </div>

      {/* Step 0 — Details */}
      {step === 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Campaign Details</h2>
          <div className="space-y-1.5">
            <Label>Campaign name *</Label>
            <Input
              placeholder="e.g. Q3 Reel Blitz"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Caption prompt template <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              className="min-h-[100px] resize-none"
              placeholder="Write an engaging Instagram caption for a video titled '{title}' by {creator}..."
              value={captionTemplate}
              onChange={(e) => setCaptionTemplate(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Step 1 — Videos */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Select Videos</h2>
          <VideoSelector selectedIds={selectedVideoIds} onChange={setSelectedVideoIds} />
        </div>
      )}

      {/* Step 2 — Accounts */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Select Accounts</h2>
          <AccountSelector selectedIds={selectedAccountIds} onChange={setSelectedAccountIds} />
        </div>
      )}

      {/* Step 3 — Schedule & Publish */}
      {step === 3 && createdId && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Schedule & Publish</h2>
          <ScheduleRuleEditor value={rule} onChange={setRule} />
          <CampaignPreviewCard
            campaignId={createdId}
            videoCount={selectedVideoIds.length}
            accountCount={selectedAccountIds.length}
            scheduleRule={rule}
          />
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || saving}>
          ← Back
        </Button>
        <div className="flex gap-2">
          {step < 2 && (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext || saving}>
              Next →
            </Button>
          )}
          {step === 2 && (
            <Button onClick={handleNextFromAccounts} disabled={!canNext || saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Next →
            </Button>
          )}
          {step === 3 && (
            <>
              <Button variant="outline" onClick={() => handlePublish(false)} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save as Draft
              </Button>
              <Button onClick={() => handlePublish(true)} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Publish Campaign
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
