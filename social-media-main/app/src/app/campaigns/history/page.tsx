"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Film } from "lucide-react";
import type { PublishHistoryWithMeta } from "@/lib/db/repositories/publish-history-repository";

const PAGE_SIZE = 50;
type HistoryEntry = PublishHistoryWithMeta & { thumbnail_url?: string | null };

function formatPublished(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function thisWeekStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function thisMonthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [page, setPage] = useState(0);

  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (accountId) p.set("account_id", accountId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(page * PAGE_SIZE));
    const res = await fetch(`/api/publish-history?${p}`);
    const data = await res.json();
    setEntries(data.entries ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, [accountId, from, to, page]);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
  }, []);

  useEffect(() => { queueMicrotask(() => void fetchEntries()); }, [fetchEntries]);

  // Derive period counts from all-time totals and current filtered entries
  const thisMonth = entries.filter((e) => e.published_at >= thisMonthStart()).length;
  const thisWeek = entries.filter((e) => e.published_at >= thisWeekStart()).length;
  const today = entries.filter((e) => e.published_at >= todayStart()).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Publish History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} total published videos</p>
        </div>
        <span
          className="text-xs text-muted-foreground border border-border rounded px-2 py-1 cursor-help"
          title="Publish history is an audit log and cannot be modified."
        >
          Read-only audit log
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <Select
          value={accountId || "_all"}
          onValueChange={(value) => { setAccountId(value === "_all" ? "" : value); setPage(0); }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
          <SelectItem value="_all">All accounts</SelectItem>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>@{a.username}</SelectItem>
          ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-auto"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(0); }}
        />
        <Input
          type="date"
          className="w-auto"
          value={to}
          onChange={(e) => { setTo(e.target.value); setPage(0); }}
        />
        {(accountId || from || to) && (
          <Button size="sm" variant="ghost" onClick={() => { setAccountId(""); setFrom(""); setTo(""); setPage(0); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Published", value: total },
          { label: "This Month", value: thisMonth },
          { label: "This Week", value: thisWeek },
          { label: "Today", value: today },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-center text-muted-foreground py-16">No publish history yet.</p>
      ) : (
        <>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="text-xs uppercase tracking-wide">
                  <TableHead className="px-4 py-2.5">Thumbnail</TableHead>
                  <TableHead className="px-4 py-2.5">Video</TableHead>
                  <TableHead className="px-4 py-2.5">Account</TableHead>
                  <TableHead className="px-4 py-2.5">Published</TableHead>
                  <TableHead className="px-4 py-2.5">Instagram ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="px-4 py-2.5">
                      {entry.thumbnail_url ? (
                        <Image
                          src={entry.thumbnail_url}
                          alt=""
                          width={40}
                          height={40}
                          className="rounded object-cover w-10 h-10"
                          unoptimized
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center">
                          <Film className="h-4 w-4 text-zinc-500" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <p className="font-medium truncate max-w-[200px]" title={entry.video_title}>
                        {entry.video_title || "—"}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-muted-foreground">@{entry.account_username}</TableCell>
                    <TableCell className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatPublished(entry.published_at)}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      {entry.instagram_media_id ? (
                        <code className="text-xs text-muted-foreground font-mono" title={entry.instagram_media_id}>
                          media_{entry.instagram_media_id.slice(0, 12)}…
                        </code>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
