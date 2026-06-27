"use client";

import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { InstagramAccount } from "@/lib/db/types";

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function AccountSelector({ selectedIds, onChange }: Props) {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then(setAccounts);
  }, []);

  const toggle = (id: string, selectable: boolean) => {
    if (!selectable) return;
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  };

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No Instagram accounts connected. Connect an account in Social Accounts first.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border divide-y divide-border">
      {accounts.map((a) => {
        const selectable = a.status === "connected";
        return (
          <label
            key={a.id}
            className={`flex items-center gap-3 px-4 py-3 ${selectable ? "cursor-pointer hover:bg-white/[0.03]" : "opacity-50 cursor-not-allowed"}`}
          >
            <Checkbox
              checked={selectedIds.includes(a.id)}
              disabled={!selectable}
              onCheckedChange={() => toggle(a.id, selectable)}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">@{a.username}</p>
              {a.display_name && (
                <p className="text-xs text-muted-foreground truncate">{a.display_name}</p>
              )}
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                a.status === "connected"
                  ? "bg-green-900/40 text-green-400"
                  : a.status === "needs_reauth"
                  ? "bg-orange-900/40 text-orange-400"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {a.status === "connected" ? "Connected" : a.status === "needs_reauth" ? "Needs reauth" : "Disconnected"}
            </span>
          </label>
        );
      })}
    </div>
  );
}
