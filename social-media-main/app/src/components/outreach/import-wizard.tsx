"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, AlertTriangle, ChevronRight, MapPin } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProspectList } from "@/lib/types";

// Includes the Google Maps lead fields alongside the LinkedIn-era ones.
const PROSPECT_FIELDS = [
  "company", "fullName", "firstName", "businessCategory", "headline", "jobTitle",
  "location", "rating", "reviewCount", "priceRange", "phone", "email", "website",
  "address", "profileUrl", "bio", "reviewsRaw", "followers", "skip",
];

const FIELD_LABELS: Record<string, string> = {
  company: "Business / Company Name",
  fullName: "Full Name",
  firstName: "First Name",
  businessCategory: "Business Category",
  headline: "Headline / Title",
  jobTitle: "Job Title",
  location: "Location / City",
  rating: "Rating",
  reviewCount: "Review Count",
  priceRange: "Price Range",
  phone: "Phone",
  email: "Email",
  website: "Website",
  address: "Address",
  profileUrl: "Profile / Maps URL",
  bio: "Bio / About",
  reviewsRaw: "Reviews (raw text)",
  followers: "Followers",
  skip: "— Skip (save to raw data) —",
};

interface State {
  step: "upload" | "mapping";
  listName: string;
  csvText: string;
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  preview: Record<string, string>[];
  mapping: Record<string, string>;
  detectedSource: "csv" | "maps";
}

const EMPTY: State = {
  step: "upload",
  listName: "",
  csvText: "",
  headers: [],
  rows: [],
  totalRows: 0,
  preview: [],
  mapping: {},
  detectedSource: "csv",
};

export function ImportWizard({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (list: ProspectList) => void;
}) {
  const [state, setState] = useState<State>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => setState(EMPTY);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => setState((s) => ({ ...s, csvText: (e.target?.result as string) ?? "" }));
    reader.readAsText(file);
  };

  const handleParse = async () => {
    if (!state.csvText.trim()) return toast.error("Select a CSV file first.");
    setUploading(true);
    try {
      const res = await fetch("/api/outreach/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: state.csvText, listName: state.listName }),
      });
      const data = await res.json();
      if (!res.ok) toast.error(data.error ?? "Parse failed");
      else
        setState((s) => ({
          ...s,
          step: "mapping",
          headers: data.headers,
          rows: data.rows,
          totalRows: data.totalRows,
          preview: data.preview,
          mapping: data.suggested,
          detectedSource: data.detectedSource ?? "csv",
        }));
    } catch {
      toast.error("Network error — try again.");
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/outreach/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listName: state.listName || "Imported List",
          rows: state.rows,
          mapping: state.mapping,
          csvText: state.csvText,
          detectedSource: state.detectedSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) toast.error(data.error ?? "Import failed");
      else {
        toast.success(`Imported ${state.totalRows} leads`);
        onImported(data as ProspectList);
        onOpenChange(false);
        reset();
      }
    } catch {
      toast.error("Network error — try again.");
    }
    setImporting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Import CSV
            {state.detectedSource === "maps" && (
              <Badge variant="secondary" className="gap-1"><MapPin className="size-3" />Google Maps</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {state.step === "upload" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>List name</Label>
              <Input
                value={state.listName}
                onChange={(e) => setState((s) => ({ ...s, listName: e.target.value }))}
                placeholder="e.g. Dubai dental clinics — June"
              />
            </div>
            <div className="space-y-2">
              <Label>CSV file</Label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-12 transition-colors hover:border-primary/40"
              >
                <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/40">
                  <Upload className="size-5 text-muted-foreground" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">{state.csvText ? "File loaded ✓" : "Click to select a CSV"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Google Maps exports and LinkedIn scraper CSVs auto-map.</p>
                </div>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </button>
            </div>
            <Button onClick={handleParse} disabled={uploading || !state.csvText} className="w-full">
              {uploading && <Loader2 className="size-4 animate-spin" />}
              {uploading ? "Parsing…" : "Parse CSV"}
            </Button>
          </div>
        )}

        {state.step === "mapping" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{state.totalRows} rows found. Map CSV columns to lead fields:</p>
            <ScrollArea className="h-72 pr-3">
              <div className="space-y-2">
                {state.headers.map((h) => (
                  <div key={h} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{h}</p>
                      {state.preview[0]?.[h] && <p className="truncate text-[10px] text-muted-foreground">e.g. {state.preview[0][h]}</p>}
                    </div>
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    <Select value={state.mapping[h] ?? "skip"} onValueChange={(v) => setState((s) => ({ ...s, mapping: { ...s.mapping, [h]: v } }))}>
                      <SelectTrigger size="sm" className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROSPECT_FIELDS.map((f) => <SelectItem key={f} value={f} className="text-xs">{FIELD_LABELS[f] ?? f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex gap-3">
              <Button onClick={handleConfirm} disabled={importing} className="flex-1">
                {importing && <Loader2 className="size-4 animate-spin" />}
                {importing ? "Importing…" : `Import ${state.totalRows} rows`}
              </Button>
              <Button variant="outline" onClick={() => setState((s) => ({ ...s, step: "upload" }))}>Back</Button>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle className="size-3" /> Unmapped columns are kept in raw data.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
