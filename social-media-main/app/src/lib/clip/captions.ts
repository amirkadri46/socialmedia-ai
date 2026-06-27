import { writeFileSync } from "fs";
import path from "path";
import type { Word, CaptionConfig } from "../types";

// ── Caption presets (PRD §7 gallery) ──────────────────────────────────────────────
// ASS colors are &HAABBGGRR. Each preset defines a base + highlight (spoken-word) look.

interface CaptionPreset {
  font: string;
  fontSize: number; // for a 1080-wide canvas
  baseColor: string; // &H...
  highlightColor: string; // active word
  outline: number;
  shadow: number;
  bold: number; // -1 = bold
  uppercase: boolean;
  marginV: number; // distance from bottom
  wordsPerLine: number;
}

function rgb(hex: string, alpha = "00"): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/** Convert an &HAABBGGRR style color to the 6-hex `&Hbbggrr&` form used by inline \c tags. */
function inlineColor(styleColor: string): string {
  const m = styleColor.replace(/&H/i, "").replace(/&$/, "");
  const bgr = m.length >= 8 ? m.slice(2) : m; // drop alpha if present
  return `&H${bgr}&`;
}

const WHITE = rgb("FFFFFF");
const GREEN = rgb("3BE477");
const YELLOW = rgb("FFD63B");
const PINK = rgb("FF3BD6");
const BLACK = rgb("000000");

export const CAPTION_PRESETS: Record<string, CaptionPreset | null> = {
  "No caption": null,
  Karaoke: { font: "Arial", fontSize: 78, baseColor: WHITE, highlightColor: GREEN, outline: 5, shadow: 2, bold: -1, uppercase: true, marginV: 320, wordsPerLine: 3 },
  Beasty: { font: "Arial", fontSize: 72, baseColor: WHITE, highlightColor: YELLOW, outline: 6, shadow: 0, bold: -1, uppercase: true, marginV: 340, wordsPerLine: 3 },
  Youshaei: { font: "Arial", fontSize: 70, baseColor: rgb("AAAAAA"), highlightColor: WHITE, outline: 4, shadow: 1, bold: -1, uppercase: true, marginV: 300, wordsPerLine: 4 },
  Mozi: { font: "Arial", fontSize: 80, baseColor: WHITE, highlightColor: GREEN, outline: 4, shadow: 2, bold: -1, uppercase: true, marginV: 360, wordsPerLine: 2 },
  "Glitch Infinite": { font: "Arial", fontSize: 76, baseColor: YELLOW, highlightColor: rgb("FF6A00"), outline: 5, shadow: 2, bold: -1, uppercase: false, marginV: 340, wordsPerLine: 3 },
  "Deep Diver": { font: "Arial", fontSize: 66, baseColor: rgb("111111"), highlightColor: BLACK, outline: 0, shadow: 0, bold: -1, uppercase: false, marginV: 300, wordsPerLine: 4 },
  "Pod P": { font: "Arial", fontSize: 74, baseColor: PINK, highlightColor: WHITE, outline: 5, shadow: 2, bold: -1, uppercase: true, marginV: 320, wordsPerLine: 3 },
  Popline: { font: "Arial", fontSize: 72, baseColor: WHITE, highlightColor: PINK, outline: 5, shadow: 2, bold: -1, uppercase: true, marginV: 320, wordsPerLine: 3 },
  "Seamless Bounce": { font: "Arial", fontSize: 74, baseColor: WHITE, highlightColor: GREEN, outline: 5, shadow: 2, bold: -1, uppercase: false, marginV: 330, wordsPerLine: 3 },
};

export function presetNames(): string[] {
  return Object.keys(CAPTION_PRESETS);
}

function fmtTime(t: number): string {
  if (t < 0) t = 0;
  // Round to centiseconds first so x.999 rolls into the next second instead of
  // producing an invalid 3-digit centisecond field (e.g. "01.100").
  const totalCs = Math.round(t * 100);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAss(text: string): string {
  return text.replace(/\n/g, " ").replace(/\{/g, "(").replace(/\}/g, ")");
}

/**
 * Build an .ass subtitle file (word-by-word highlight) for the [start,end] slice,
 * with times rebased to 0 (the clip starts at 0). Returns the file path, or "" for
 * the "No caption" preset.
 */
export interface CaptionOptions {
  /** Optional on-screen text hook shown over the first 5s (auto-hook). */
  hook?: string;
}

export function buildAssFile(
  words: Word[],
  presetName: string,
  start: number,
  end: number,
  outDir: string,
  canvasW = 1080,
  canvasH = 1920,
  options: CaptionOptions = {}
): string {
  const preset = CAPTION_PRESETS[presetName];
  const hook = options.hook?.trim();

  // Even with "No caption", we still render an .ass if there's a hook to burn.
  if (!preset && !hook) return "";

  const slice = words
    .filter((w) => w.end > start && w.start < end)
    .map((w) => ({ text: w.text, start: Math.max(0, w.start - start), end: Math.max(0, w.end - start) }));
  if (slice.length === 0 && !hook) return "";

  const styleDefs: string[] = [];
  if (preset) {
    const styleColors = `${preset.baseColor},${preset.highlightColor},${rgb("000000")},${rgb("000000", "80")}`;
    styleDefs.push(
      `Style: Base,${preset.font},${preset.fontSize},${styleColors},${preset.bold},0,0,0,100,100,0,0,1,${preset.outline},${preset.shadow},2,80,80,${preset.marginV},1`
    );
  }
  // Hook: opaque-box, top-center, white text on black — matches the OpusClip hook chip.
  // Wider L/R margins + WrapStyle 0 keep long hooks inside the frame on two lines.
  const hookFontSize = Math.round(canvasW * 0.044);
  const hookMargin = Math.round(canvasW * 0.09);
  styleDefs.push(
    `Style: Hook,Arial,${hookFontSize},${WHITE},${WHITE},${BLACK},${rgb("000000")},-1,0,0,0,100,100,0,0,3,2,0,8,${hookMargin},${hookMargin},${Math.round(canvasH * 0.06)},1`
  );

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${canvasW}
PlayResY: ${canvasH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleDefs.join("\n")}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines: string[] = [];

  // Hook event over the first 5 seconds.
  if (hook) {
    lines.push(`Dialogue: 1,${fmtTime(0)},${fmtTime(5)},Hook,,0,0,0,,${escapeAss(hook)}`);
  }

  // Group words into lines, then emit one Dialogue per word with that word highlighted.
  if (preset) {
    for (let i = 0; i < slice.length; i += preset.wordsPerLine) {
      const group = slice.slice(i, i + preset.wordsPerLine);
      group.forEach((active, idx) => {
        const text = group
          .map((w, j) => {
            let raw = w.text;
            // Drop leading punctuation that Deepgram sometimes splits onto a word
            // (avoids artifacts like ",IF" or ",WHO" at the start of a line).
            if (j === 0) raw = raw.replace(/^[\s,.;:!?'"-]+/, "");
            const t = preset.uppercase ? raw.toUpperCase() : raw;
            if (!t) return "";
            return j === idx
              ? `{\\c${inlineColor(preset.highlightColor)}}${escapeAss(t)}{\\c${inlineColor(preset.baseColor)}}`
              : escapeAss(t);
          })
          .filter(Boolean)
          .join(" ");
        const next = group[idx + 1];
        const evEnd = next ? next.start : active.end + 0.05;
        lines.push(
          `Dialogue: 0,${fmtTime(active.start)},${fmtTime(evEnd)},Base,,0,0,0,,${text}`
        );
      });
    }
  }

  const assPath = path.join(outDir, `captions-${start.toFixed(2)}.ass`);
  writeFileSync(assPath, `${header}\n${lines.join("\n")}\n`, "utf-8");
  return assPath;
}

// ── CaptionConfig-driven ASS (editor export, parity with the browser preview) ────────

/**
 * Build an .ass file from a full CaptionConfig (the editor's caption model). Words are
 * in window coords already rebased to 0. canvasW/H are the export dimensions.
 */
export function buildAssFromConfig(
  words: Word[],
  config: CaptionConfig,
  outDir: string,
  canvasW = 1080,
  canvasH = 1920,
  fileTag = "edit"
): string {
  if (!config.enabled || words.length === 0) return "";

  const scale = canvasH / 1920;
  const fontSize = Math.round(config.font.sizePx * scale);
  let base = rgb(config.font.color);
  let highlight = rgb(config.effects.highlightColor);
  const stroke = rgb(config.font.strokeColor);
  let outline = config.font.strokeWidthPx > 0 ? Math.max(1, Math.round(config.font.strokeWidthPx * scale)) : 0;
  let shadow = config.font.shadow ? 2 : 0;
  let isUppercase = config.font.uppercase;

  if (config.preset === "Hormozi Style") {
    isUppercase = true;
    outline = Math.max(1, Math.round(4 * scale)); // Outline: 4
    shadow = 2; // Shadow: 2
    highlight = rgb("#A3E635"); // Vibrant neon yellow/green
  }
  
  const isColorSwap = config.preset === "Ali Abdal Style" || config.preset === "Bubble Style";
  if (isColorSwap) {
    // Render the active word using a highly contrasting color swap tag
    highlight = rgb("#000000"); // Absolute black for the active word
    base = rgb("#A0A0A0"); // Muted inactive color
  }

  const box = config.effects.wordBgColor || config.effects.animation === "box";
  const back = config.effects.wordBgColor ? rgb(config.effects.wordBgColor) : rgb("000000", "80");
  const borderStyle = box ? 3 : 1;
  const bold = -1;
  const alignment =
    config.effects.position === "top" ? 8 : config.effects.position === "middle" ? 5 : 2;
  const marginV = config.effects.position === "middle" ? 0 : Math.round(canvasH * 0.16);
  const perLine = config.effects.lines === 1 ? 4 : 3;

  const styleLine = `Style: Cap,${config.font.family},${fontSize},${base},${highlight},${stroke},${back},${bold},${config.font.italic ? -1 : 0},${config.font.underline ? -1 : 0},0,100,100,0,0,${borderStyle},${outline},${shadow},${alignment},120,120,${marginV},1`;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${canvasW}
PlayResY: ${canvasH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // Drag-to-reposition: \\pos overrides alignment-based placement.
  const posTag = config.offset
    ? `{\\pos(${Math.round(config.offset.x * canvasW)},${Math.round(config.offset.y * canvasH)})}`
    : "";
  const popTag = (active: boolean) =>
    active && (config.effects.animation === "pop" || config.effects.animation === "bounce")
      ? "{\\fscx115\\fscy115}"
      : "";

  const lines: string[] = [];
  for (let i = 0; i < words.length; i += perLine) {
    const group = words.slice(i, i + perLine);
    group.forEach((active, idx) => {
      const text = group
        .map((w, j) => {
          let raw = w.text.replace(/,+$/, "");
          if (j === 0) raw = raw.replace(/^[\s,.;:!?'"-]+/, "");
          const t = isUppercase ? raw.toUpperCase() : raw;
          if (!t) return "";
          // Per-word highlight color (3A) wins over the karaoke base/highlight,
          // and persists whether or not this is the active spoken word.
          const wc = w.color ? inlineColor(rgb(w.color)) : null;
          if (j === idx) {
            return `${popTag(true)}{\\c${wc ?? inlineColor(highlight)}}${escapeAss(t)}{\\c${inlineColor(base)}\\fscx100\\fscy100}`;
          }
          return wc ? `{\\c${wc}}${escapeAss(t)}{\\c${inlineColor(base)}}` : escapeAss(t);
        })
        .filter(Boolean)
        .join(" ");
      const next = group[idx + 1];
      const evEnd = next ? next.start : active.end + 0.05;
      lines.push(`Dialogue: 0,${fmtTime(active.start)},${fmtTime(evEnd)},Cap,,0,0,0,,${posTag}${text}`);
    });
  }

  const assPath = path.join(outDir, `captions-${fileTag}.ass`);
  writeFileSync(assPath, `${header}\n${lines.join("\n")}\n`, "utf-8");
  return assPath;
}
