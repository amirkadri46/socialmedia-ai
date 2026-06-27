"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export interface LibraryFilters {
  platform: string;
  publish_status: string;
  search: string;
}

interface FilterBarProps {
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const [search, setSearch] = useState(filters.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange({ ...filters, search: val }), 300);
  };

  const active = filters.platform || filters.publish_status || filters.search;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Input
        placeholder="Search by title or creator..."
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        className="w-60"
      />
      <Select
        value={filters.platform || "_all"}
        onValueChange={(v) => onChange({ ...filters, platform: v === "_all" ? "" : v })}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All Platforms</SelectItem>
          <SelectItem value="youtube">YouTube</SelectItem>
          <SelectItem value="instagram">Instagram</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.publish_status || "_all"}
        onValueChange={(v) =>
          onChange({ ...filters, publish_status: v === "_all" ? "" : v })
        }
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All Statuses</SelectItem>
          <SelectItem value="unpublished">Available</SelectItem>
          <SelectItem value="scheduled">Scheduled</SelectItem>
          <SelectItem value="published">Published</SelectItem>
        </SelectContent>
      </Select>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            onChange({ platform: "", publish_status: "", search: "" });
          }}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
