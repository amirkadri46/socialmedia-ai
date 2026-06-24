import { v4 as uuid } from "uuid";
import type { TextOverlay } from "../types";

// ── Layer presets ──────────────────────────────────────────────────────────────────────
// Reusable branding overlays applied with one click. A preset is a stack of layers that, on
// apply, are materialized into the ClipEdit's `textOverlays` (in z-index order) — after which
// they are normal, fully-editable overlays (drag/resize/recolor). Presets persist across
// projects in localStorage (global key), so the same branding is available in every clip.

export type LayerType = "banner" | "logo" | "handle" | "subtitleSafe" | "watermark";

export interface PresetLayer {
  id: string;
  type: LayerType;
  label: string; // shown in the panel
  enabled: boolean; // toggled on/off before applying
  text?: string; // for logo / handle / watermark / banner
  color?: string; // text color
  bg?: string; // background (banner / safe-area container)
  opacity?: number; // 0–1 (watermark / containers)
  sizePx?: number; // 1920-referenced font size
  x?: number; // normalized canvas position (0–1)
  y?: number;
  widthPct?: number; // max width as % of canvas
  bold?: boolean;
}

export interface LayerPreset {
  id: string;
  name: string;
  layers: PresetLayer[];
}

const STORAGE_KEY = "clip-editor-layer-presets-v1";

/** Z-order of layer types from back → front (earlier = lower; later overlays render on top). */
const Z_ORDER: LayerType[] = ["banner", "subtitleSafe", "watermark", "logo", "handle"];

/** The seeded default branding preset (bottom banner + logo + handle + safe-area + watermark). */
export function defaultPreset(): LayerPreset {
  return {
    id: uuid(),
    name: "Default branding",
    layers: [
      { id: uuid(), type: "banner", label: "Bottom banner", enabled: true, text: " ", bg: "#000000", widthPct: 100, sizePx: 70, x: 0.5, y: 0.93 },
      { id: uuid(), type: "logo", label: "Logo", enabled: true, text: "KICK", color: "#53FC18", bold: true, sizePx: 64, x: 0.16, y: 0.93 },
      { id: uuid(), type: "handle", label: "Social handle", enabled: true, text: "@zevon_labs", color: "#FFFFFF", sizePx: 34, x: 0.66, y: 0.94 },
      { id: uuid(), type: "subtitleSafe", label: "Subtitle safe-area", enabled: false, text: "Subtitle safe area", bg: "#1118271A", color: "#FFFFFF", opacity: 0.5, sizePx: 28, x: 0.5, y: 0.78, widthPct: 86 },
      { id: uuid(), type: "watermark", label: "Watermark", enabled: false, text: "@zevon_labs", color: "#FFFFFF", opacity: 0.18, sizePx: 44, x: 0.5, y: 0.5 },
    ],
  };
}

export function loadPresets(): LayerPreset[] {
  if (typeof window === "undefined") return [defaultPreset()];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [defaultPreset()];
    const parsed = JSON.parse(raw) as LayerPreset[];
    return Array.isArray(parsed) && parsed.length ? parsed : [defaultPreset()];
  } catch {
    return [defaultPreset()];
  }
}

export function savePresets(presets: LayerPreset[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)); } catch { /* quota / private mode */ }
}

/**
 * Materialize a preset's ENABLED layers into TextOverlays spanning the whole clip, in
 * z-index order (banner at the back, handle in front). Each becomes a regular overlay that
 * the user can move/edit afterward.
 */
export function presetToOverlays(preset: LayerPreset, durationSec: number): TextOverlay[] {
  const enabled = preset.layers.filter((l) => l.enabled);
  enabled.sort((a, b) => Z_ORDER.indexOf(a.type) - Z_ORDER.indexOf(b.type));
  return enabled.map((l) => ({
    id: uuid(),
    text: l.text ?? "",
    start: 0,
    end: Math.max(0.1, durationSec),
    x: l.x ?? 0.5,
    y: l.y ?? 0.9,
    style: {
      bg: l.bg,
      color: l.color ?? "#FFFFFF",
      sizePx: l.sizePx ?? 40,
      bold: l.bold ?? false,
      radiusPx: l.type === "banner" ? 0 : 8,
      align: "center",
      widthPct: l.widthPct,
      opacity: l.opacity,
    },
  }));
}
