// Editor keyboard shortcuts (configurable in Settings, bound in the clip editor).
// Combos are normalized strings: optional "mod" (Ctrl/⌘), "alt", "shift" modifiers
// joined with "+", followed by the lowercased key (e.g. "mod+shift+z", "space", "s").

export type ShortcutAction =
  | "playPause"
  | "prevFrame"
  | "nextFrame"
  | "split"
  | "delete"
  | "mute"
  | "addText"
  | "undo"
  | "redo";

export type EditorShortcuts = Record<ShortcutAction, string>;

export const SHORTCUT_ACTIONS: { id: ShortcutAction; label: string; default: string }[] = [
  { id: "playPause", label: "Play / Pause", default: "space" },
  { id: "prevFrame", label: "Previous frame", default: "arrowleft" },
  { id: "nextFrame", label: "Next frame", default: "arrowright" },
  { id: "split", label: "Split at playhead", default: "c" },
  { id: "delete", label: "Delete selection", default: "delete" },
  { id: "mute", label: "Mute base audio", default: "m" },
  { id: "addText", label: "Add text", default: "t" },
  { id: "undo", label: "Undo", default: "mod+z" },
  { id: "redo", label: "Redo", default: "mod+shift+z" },
];

export const DEFAULT_SHORTCUTS: EditorShortcuts = SHORTCUT_ACTIONS.reduce(
  (acc, a) => { acc[a.id] = a.default; return acc; },
  {} as EditorShortcuts
);

const MOD_KEYS = new Set(["control", "meta", "alt", "shift"]);

/** Turn a keyboard event into a normalized combo string. */
export function eventToCombo(e: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
}): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  if (MOD_KEYS.has(key)) return parts.join("+"); // modifier pressed alone
  parts.push(key);
  return parts.join("+");
}

const KEY_LABELS: Record<string, string> = {
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  space: "Space",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  delete: "Del",
  backspace: "Backspace",
  escape: "Esc",
  enter: "Enter",
};

/** Human-readable label for a combo (e.g. "mod+shift+z" → "Ctrl + Shift + Z"). */
export function formatCombo(combo: string): string {
  if (!combo) return "—";
  return combo
    .split("+")
    .map((p) => KEY_LABELS[p] ?? (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" + ");
}

/** Merge stored shortcuts over the defaults (fills any missing actions). */
export function resolveShortcuts(stored?: Partial<EditorShortcuts> | null): EditorShortcuts {
  return { ...DEFAULT_SHORTCUTS, ...(stored ?? {}) };
}
