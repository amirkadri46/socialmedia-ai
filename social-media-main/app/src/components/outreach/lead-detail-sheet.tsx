"use client";

import {
  Globe,
  GlobeLock,
  Target,
  Star,
  MessageSquare,
  MapPin,
  Phone,
  Mail,
  ExternalLink,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PriorityBadge } from "./priority-badge";
import { LeadStatusSelect } from "./lead-status-select";
import { OutreachMessageTabs } from "./outreach-message-tabs";
import { WEBSITE_STATUS_LABELS } from "@/lib/lead-scoring";
import type { Prospect } from "@/lib/types";

function monogram(p: Prospect): string {
  const src = p.company || p.fullName || "?";
  return src
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function LeadDetailSheet({
  prospect,
  open,
  whatsappLimit,
  onOpenChange,
  onUpdate,
  onRegenerate,
  regenerating,
}: {
  prospect: Prospect | null;
  open: boolean;
  whatsappLimit: number;
  onOpenChange: (open: boolean) => void;
  onUpdate: (updates: Partial<Prospect>) => void;
  onRegenerate: () => void;
  regenerating?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        {prospect && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback>{monogram(prospect)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{prospect.company || prospect.fullName || "Lead"}</SheetTitle>
                  <SheetDescription className="truncate">
                    {prospect.businessCategory || prospect.headline || "—"}
                    {prospect.location ? ` · ${prospect.location}` : ""}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <ScrollArea className="h-[calc(100vh-4rem)]">
              <div className="space-y-6 p-4">
                {/* Intelligence */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Intelligence</h4>
                    <PriorityBadge score={prospect.priorityScore} level={prospect.priorityLevel} />
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                    {prospect.rating != null && (
                      <span className="flex items-center gap-1.5"><Star className="size-3.5 text-muted-foreground" />{prospect.rating} / 5</span>
                    )}
                    {prospect.reviewCount != null && (
                      <span className="flex items-center gap-1.5"><MessageSquare className="size-3.5 text-muted-foreground" />{prospect.reviewCount} reviews</span>
                    )}
                    {prospect.priceRange && <span className="text-muted-foreground">{prospect.priceRange}</span>}
                    <span className="flex items-center gap-1.5">
                      {prospect.websiteStatus === "no_website" ? (
                        <GlobeLock className="size-3.5 text-amber-500" />
                      ) : (
                        <Globe className="size-3.5 text-muted-foreground" />
                      )}
                      {WEBSITE_STATUS_LABELS[prospect.websiteStatus ?? "unknown"]}
                    </span>
                  </div>

                  {prospect.outreachAngle && (
                    <div className="rounded-lg border bg-muted/30 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Target className="size-3.5" /> Outreach angle</p>
                      <p className="mt-1 text-sm">{prospect.outreachAngle}</p>
                    </div>
                  )}
                  {prospect.reviewSummary && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Review summary</p>
                      <p className="mt-1 text-sm">{prospect.reviewSummary}</p>
                    </div>
                  )}

                  <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {prospect.address && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{prospect.address}</span>}
                    {prospect.phone && <span className="flex items-center gap-1.5"><Phone className="size-3.5" />{prospect.phone}</span>}
                    {prospect.email && <span className="flex items-center gap-1.5"><Mail className="size-3.5" />{prospect.email}</span>}
                    {prospect.website && (
                      <a href={prospect.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
                        <ExternalLink className="size-3.5" />{prospect.website}
                      </a>
                    )}
                  </div>
                </section>

                <Separator />

                {/* Messages */}
                <section>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outreach</h4>
                  <OutreachMessageTabs
                    key={`${prospect.id}:${prospect.lastDraftedAt ?? ""}`}
                    prospect={prospect}
                    whatsappLimit={whatsappLimit}
                    onSave={onUpdate}
                    onRegenerate={onRegenerate}
                    regenerating={regenerating}
                  />
                </section>

                <Separator />

                {/* CRM */}
                <section className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pipeline</h4>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <LeadStatusSelect
                      value={prospect.leadStatus}
                      onChange={(s) => onUpdate({ leadStatus: s })}
                      className="h-9 w-full text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Last contacted</Label>
                      <Input
                        type="date"
                        value={prospect.lastContactedAt ? prospect.lastContactedAt.slice(0, 10) : ""}
                        onChange={(e) =>
                          onUpdate({ lastContactedAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Follow up</Label>
                      <Input
                        type="date"
                        value={prospect.followUpDate ? prospect.followUpDate.slice(0, 10) : ""}
                        onChange={(e) => onUpdate({ followUpDate: e.target.value || undefined })}
                      />
                    </div>
                  </div>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
