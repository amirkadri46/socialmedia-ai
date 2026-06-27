import type { CaptionConfig } from "../types";

// Client-safe visual descriptors for the caption presets, used to render previews
// in the New Clip picker and the editor. These mirror the ASS styling in captions.ts
// (server-only). Keep the two in sync if you tweak a preset.

export interface CaptionStyle {
  name: string;
  base: string; // CSS color for inactive words
  highlight: string; // CSS color for the active (spoken) word
  uppercase: boolean;
  bold: boolean;
  outline: string | null; // text-stroke color, null = none
  box: string | null; // background box color (e.g. Deep Diver), null = none
  font: string; // font family
  animation: CaptionConfig["effects"]["animation"];
  // Structural layout modifiers (optional; mirror the CaptionConfig fields). Absent = legacy.
  layoutVariant?: CaptionConfig["layoutVariant"]; // container/layout treatment
  textTransform?: CaptionConfig["textTransform"]; // overrides `uppercase` when set
  textShadow?: string; // CSS text-shadow / drop-shadow descriptor
  textStroke?: string; // CSS text-stroke descriptor (e.g. "2px #000")
  containerBgColor?: string; // background color behind the caption container
}

export const CAPTION_STYLES: CaptionStyle[] = [
  { name: "No caption", base: "#9ca3af", highlight: "#9ca3af", uppercase: false, bold: false, outline: null, box: null, font: "Arial", animation: "none" },
  { name: "Karaoke", base: "#FFFFFF", highlight: "#3BE477", uppercase: true, bold: true, outline: "#000000", box: null, font: "Arial", animation: "karaoke" },
  { name: "Beasty", base: "#FFFFFF", highlight: "#FFD63B", uppercase: true, bold: true, outline: "#000000", box: null, font: "Arial", animation: "pop" },
  { name: "Youshaei", base: "#AAAAAA", highlight: "#FFFFFF", uppercase: true, bold: true, outline: "#000000", box: null, font: "Arial", animation: "none" },
  { name: "Mozi", base: "#FFFFFF", highlight: "#3BE477", uppercase: true, bold: true, outline: "#000000", box: null, font: "Arial", animation: "pop" },
  { name: "Glitch Infinite", base: "#FFD63B", highlight: "#FF6A00", uppercase: false, bold: true, outline: "#000000", box: null, font: "Arial", animation: "bounce" },
  { name: "Deep Diver", base: "#111111", highlight: "#000000", uppercase: false, bold: true, outline: null, box: "#FFFFFF", font: "Arial", animation: "box" },
  { name: "Pod P", base: "#FF3BD6", highlight: "#FFFFFF", uppercase: true, bold: true, outline: "#000000", box: null, font: "Arial", animation: "pop" },
  { name: "Popline", base: "#FFFFFF", highlight: "#FF3BD6", uppercase: true, bold: true, outline: "#000000", box: null, font: "Arial", animation: "karaoke" },
  { name: "Seamless Bounce", base: "#FFFFFF", highlight: "#3BE477", uppercase: false, bold: true, outline: "#000000", box: null, font: "Arial", animation: "bounce" },
  // Premium presets — exercise the structural layout modifiers.
  { name: "Ali Abdal Style", base: "#A0A0A0", highlight: "#000000", uppercase: false, bold: true, outline: null, box: "#FFFFFF", font: "Inter", animation: "box", layoutVariant: "full-box", containerBgColor: "#FFFFFF" },
  { name: "Bubble Style", base: "#FFFFFF", highlight: "#FFFFFF", uppercase: false, bold: true, outline: null, box: "#3E8E7E", font: "Georgia", animation: "pop", layoutVariant: "bubble", containerBgColor: "#3E8E7E" },
  { name: "Hormozi Style", base: "#A3E635", highlight: "#A3E635", uppercase: true, bold: true, outline: "#000000", box: null, font: "Impact", animation: "pop", layoutVariant: "glow", textTransform: "uppercase", textShadow: "2px 2px 0px #000000" },
];

export function styleByName(name: string): CaptionStyle {
  return CAPTION_STYLES.find((s) => s.name === name) ?? CAPTION_STYLES[1];
}

export const FONT_FAMILIES = ["Arial", "Roboto", "Montserrat", "Inter", "Impact", "Georgia"];

/** Build a full CaptionConfig from a preset name (the parity source for preview + export). */
export function presetToCaptionConfig(presetName: string): CaptionConfig {
  const s = styleByName(presetName);
  return {
    enabled: presetName !== "No caption",
    preset: presetName,
    font: {
      family: s.font,
      sizePx: 64,
      color: s.base,
      uppercase: s.uppercase,
      strokeColor: s.outline ?? "#000000",
      strokeWidthPx: s.outline ? 6 : 0,
      shadow: true,
      italic: false,
      underline: false,
    },
    effects: {
      position: "bottom",
      animation: s.animation,
      lines: 3,
      highlightColor: s.highlight,
      wordBgColor: s.box ?? undefined,
    },
  };
}
