"use client";

import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import type { CaptionStyle } from "@/lib/clip/caption-styles";

/** A small visual preview of a caption preset — sample text styled like the burned-in
 *  result. On hover the highlight cycles word-by-word so you see the karaoke effect. */
export function CaptionPreview({
  style,
  selected,
  onSelect,
}: {
  style: CaptionStyle;
  selected: boolean;
  onSelect: () => void;
}) {
  const isNone = style.name === "No caption";
  const words = ["TO", "GET", "STARTED"];
  const [hovered, setHovered] = useState(false);
  const [tick, setTick] = useState(1);

  useEffect(() => {
    if (!hovered || isNone) return;
    const id = setInterval(() => setTick((t) => (t + 1) % words.length), 450);
    return () => clearInterval(id);
  }, [hovered, isNone, words.length]);

  const highlightIdx = hovered ? tick : 1; // cycle on hover, else highlight the middle word

  function wordStyle(active: boolean): React.CSSProperties {
    const color = active ? style.highlight : style.base;
    return {
      color,
      fontWeight: style.bold ? 800 : 600,
      textTransform: style.uppercase ? "uppercase" : "none",
      WebkitTextStroke: style.outline ? `1px ${style.outline}` : undefined,
      paintOrder: "stroke fill",
      backgroundColor: style.box ?? undefined,
      borderRadius: style.box ? 3 : undefined,
      padding: style.box ? "0 3px" : undefined,
    };
  }

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={style.name}
      className={`group relative flex flex-col items-center gap-1.5 rounded-xl border p-1.5 transition-all ${
        selected
          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
          : "border-border bg-card hover:border-foreground/20"
      }`}
    >
      {/* Mini preview canvas */}
      <div className="relative flex h-16 w-full items-end justify-center overflow-hidden rounded-lg bg-gradient-to-b from-zinc-700 to-zinc-900">
        {isNone ? (
          <div className="flex h-full w-full items-center justify-center">
            <Ban className="h-5 w-5 text-zinc-500" />
          </div>
        ) : (
          <div className="mb-2 flex flex-wrap items-center justify-center gap-x-1 px-1 text-center text-[11px] leading-tight">
            {words.map((w, i) => (
              <span key={i} style={wordStyle(i === highlightIdx)}>
                {w}
              </span>
            ))}
          </div>
        )}
      </div>
      <span
        className={`text-[10px] font-medium ${selected ? "text-foreground" : "text-muted-foreground"}`}
      >
        {style.name}
      </span>
    </button>
  );
}
