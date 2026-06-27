import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from "fs";
import path from "path";
import { DEFAULT_SHORTCUTS, type EditorShortcuts } from "./clip/shortcuts";

const DATA_DIR = path.join(process.cwd(), "..", "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export interface AppSettings {
  provider: "openai" | "openrouter";
  openaiApiKey: string;
  openrouterApiKey: string;
  openrouterModel: string;
  geminiModel: string;
  // Outreach settings
  apifyApiToken: string;
  linkedinCharLimit: number;
  emailLengthGuidance: string;
  // Lead intelligence
  whatsappCharLimit: number;
  senderName: string;
  defaultLocationLabel: string;
  // Clipping
  transcriptionProvider: "deepgram" | "assemblyai" | "local";
  deepgramApiKey: string;
  assemblyaiApiKey: string;
  defaultCaptionPreset: string;
  defaultAspectRatio: string;
  defaultClipLength: string;
  ytDlpCookiesBrowser: string;
  ytDlpCookiesText: string;
  // Social
  metaAppId: string;
  metaAppSecret: string;
  enableSocialPublish: boolean;
  // Clip editor
  editorShortcuts: EditorShortcuts;
}

const DEFAULTS: AppSettings = {
  provider: "openrouter",
  openaiApiKey: "",
  openrouterApiKey: "",
  openrouterModel: "deepseek/deepseek-v4-flash",
  geminiModel: "gemini-2.5-flash",
  apifyApiToken: "",
  linkedinCharLimit: 200,
  emailLengthGuidance: "Aim for 80–130 words. Conversational and direct. No self-introduction opener.",
  whatsappCharLimit: 600,
  senderName: "",
  defaultLocationLabel: "",
  // Clipping
  transcriptionProvider: "deepgram",
  deepgramApiKey: "",
  assemblyaiApiKey: "",
  defaultCaptionPreset: "Karaoke",
  defaultAspectRatio: "9:16",
  defaultClipLength: "Auto (0-3m)",
  ytDlpCookiesBrowser: "",
  ytDlpCookiesText: "",
  // Social
  metaAppId: "",
  metaAppSecret: "",
  enableSocialPublish: false,
  // Clip editor
  editorShortcuts: { ...DEFAULT_SHORTCUTS },
};

export function readSettings(): AppSettings {
  if (!existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeFileAtomic(p: string, data: string): void {
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, data, "utf-8");
  try {
    renameSync(tmp, p);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

export function writeSettings(settings: AppSettings) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
