import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

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
  // Clipping
  transcriptionProvider: "deepgram" | "assemblyai" | "local";
  deepgramApiKey: string;
  assemblyaiApiKey: string;
  defaultCaptionPreset: string;
  defaultAspectRatio: string;
  defaultClipLength: string;
  ytDlpCookiesBrowser: string;
  // Social
  metaAppId: string;
  metaAppSecret: string;
  enableSocialPublish: boolean;
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
  // Clipping
  transcriptionProvider: "deepgram",
  deepgramApiKey: "",
  assemblyaiApiKey: "",
  defaultCaptionPreset: "Karaoke",
  defaultAspectRatio: "9:16",
  defaultClipLength: "Auto (0-3m)",
  ytDlpCookiesBrowser: "",
  // Social
  metaAppId: "",
  metaAppSecret: "",
  enableSocialPublish: false,
};

export function readSettings(): AppSettings {
  if (!existsSync(SETTINGS_PATH)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(settings: AppSettings) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}
