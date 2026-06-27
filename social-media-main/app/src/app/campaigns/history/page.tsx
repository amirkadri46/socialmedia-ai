"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Film } from "lucide-react";

const PAGE_SIZE = 50;

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
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [page, setPage] = useState(0);

  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fetchEntries = async () => {
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
  };

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
  }, []);

  useEffect(() => { fetchEntries(); }, [accountId, from, to, page]);

  // Derive period counts from all-time totals and current filtered entries
  const now = new Date().toISOString();
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
        <select
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          value={accountId}
          onChange={(e) => { setAccountId(e.target.value); setPage(0); }}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>@{a.username}</option>
          ))}
        </select>
        <input
          type="date"
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
          value={from}
          onChange={(e) => { setFrom(e.target.value); setPage(0); }}
        />
        <input
          type="date"
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
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
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">Thumbnail</th>
                  <th className="text-left px-4 py-2.5">Video</th>
                  <th className="text-left px-4 py-2.5">Account</th>
                  <th className="text-left px-4 py-2.5">Published</th>
                  <th className="text-left px-4 py-2.5">Instagram ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
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
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium truncate max-w-[200px]" title={entry.video_title}>
                        {entry.video_title || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">@{entry.account_username}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatPublished(entry.published_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.instagram_media_id ? (
                        <code className="text-xs text-muted-foreground font-mono" title={entry.instagram_media_id}>
                          media_{entry.instagram_media_id.slice(0, 12)}…
                        </code>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
