"use client";

import type { CSSProperties } from "react";
import type { CaptionConfig, Word } from "@/lib/types";

// Browser caption renderer — the visual twin of the server ASS in captions.ts.
// Given the active window time, render the current word group with the spoken word
// highlighted, styled from CaptionConfig (font/color/stroke/shadow/uppercase/anim).

function wordGroup(words: Word[], t: number, perLine: number): { words: Word[]; activeIdx: number } | null {
  if (!words.length) return null;
  // Find the active word (or the nearest upcoming one).
  let idx = words.findIndex((w) => t >= w.start && t < w.end);
  if (idx < 0) {
    // between words — keep showing the last group that started
    idx = words.findIndex((w) => w.start > t);
    if (idx < 0) idx = words.length - 1;
    else idx = Math.max(0, idx - 1);
  }
  const groupStart = Math.floor(idx / perLine) * perLine;
  return { words: words.slice(groupStart, groupStart + perLine), activeIdx: idx - groupStart };
}

export function CaptionLayer({
  config,
  words,
  windowT,
  canvasH,
  onPointerDown,
}: {
  config: CaptionConfig;
  words: Word[];
  windowT: number; // window-time seconds
  canvasH: number; // rendered canvas height in px (for font scaling)
  onPointerDown?: (e: React.PointerEvent) => void; // drag-to-reposition handle
}) {
  if (!config.enabled) return null;
  const perLine = config.effects.lines === 1 ? 4 : 3;
  const group = wordGroup(words, windowT, perLine);
  if (!group) return null;

  // Font size is authored against a 1920px-tall canvas; scale to the rendered size.
  const scale = canvasH / 1920;
  const fontSize = config.font.sizePx * scale;

  const posStyle: CSSProperties =
    config.offset
      ? { left: `${config.offset.x * 100}%`, top: `${config.offset.y * 100}%`, transform: "translate(-50%,-50%)" }
      : config.effects.position === "top"
      ? { top: "12%", left: "50%", transform: "translateX(-50%)" }
      : config.effects.position === "middle"
      ? { top: "50%", left: "50%", transform: "translate(-50%,-50%)" }
      : { bottom: "16%", left: "50%", transform: "translateX(-50%)" };

  const shadow = config.font.shadow ? "0 2px 6px rgba(0,0,0,0.7)" : undefined;
  const stroke =
    config.font.strokeWidthPx > 0
      ? `${config.font.strokeWidthPx * scale}px ${config.font.strokeColor}`
      : undefined;

  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute z-20 max-w-[88%] text-center leading-tight ${onPointerDown ? "cursor-move" : "pointer-events-none"}`}
      style={posStyle}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        {group.words.map((w, i) => {
          const active = i === group.activeIdx;
          
          let raw = w.text.replace(/,+$/, "");
          if (i === 0) raw = raw.replace(/^[\s,.;:!?'"-]+/, "");

          let isUppercase = config.font.uppercase;
          let fontColor = w.color ?? config.font.color;
          let highlightColor = config.effects.highlightColor;
          let currentStroke = stroke;
          let currentShadow = shadow;

          if (config.preset === "Hormozi Style") {
            isUppercase = true;
            highlightColor = "#A3E635";
            currentStroke = `${4 * scale}px ${config.font.strokeColor}`;
            currentShadow = "0 2px 6px rgba(0,0,0,0.7)";
          }

          const isColorSwap = config.preset === "Ali Abdal Style" || config.preset === "Bubble Style";
          if (isColorSwap) {
            highlightColor = "#000000";
            fontColor = "#A0A0A0";
          }

          const text = isUppercase ? raw.toUpperCase() : raw;
          const useBox = config.effects.animation === "box" || config.effects.wordBgColor;
          const popScale = active && config.effects.animation === "pop" ? 1.12 : 1;
          
          return (
            <span
              key={w.start}
              style={{
                fontFamily: config.font.family,
                fontSize,
                fontWeight: 800,
                fontStyle: config.font.italic ? "italic" : undefined,
                textDecoration: config.font.underline ? "underline" : undefined,
                color: active ? highlightColor : fontColor,
                WebkitTextStroke: currentStroke,
                paintOrder: "stroke fill",
                textShadow: currentShadow,
                backgroundColor: useBox
                  ? config.effects.wordBgColor || (active ? "transparent" : "rgba(255,255,255,0.92)")
                  : undefined,
                borderRadius: useBox ? 4 * scale : undefined,
                padding: useBox ? `0 ${4 * scale}px` : undefined,
                transform: `scale(${popScale})`,
                transition: "transform 120ms ease",
                display: "inline-block",
              }}
            >
              {text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
