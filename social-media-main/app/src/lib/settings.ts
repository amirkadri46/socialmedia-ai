import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "..", "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export interface AppSettings {
  provider: "openai" | "openrouter";
  openaiApiKey: string;
  openrouterApiKey: string;
  openrouterModel: string;
}

const DEFAULTS: AppSettings = {
  provider: "openrouter",
  openaiApiKey: "",
  openrouterApiKey: "",
  openrouterModel: "deepseek/deepseek-v4-flash",
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
