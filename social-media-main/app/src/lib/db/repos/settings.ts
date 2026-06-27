import type { AppSettings } from "@/lib/settings";
import { readSettings as fileReadSettings, writeSettings as fileWriteSettings } from "@/lib/settings";
import { DEFAULT_SHORTCUTS } from "@/lib/clip/shortcuts";
import { serverClient } from "../client";

// Non-secret fields stored in DB. Secrets always come from env vars.
type NonSecretSettings = Omit<
  AppSettings,
  | "openaiApiKey"
  | "openrouterApiKey"
  | "apifyApiToken"
  | "deepgramApiKey"
  | "assemblyaiApiKey"
  | "metaAppId"
  | "metaAppSecret"
  | "ytDlpCookiesText"
  | "ytDlpCookiesBrowser"
>;

export interface SettingsRepo {
  get(): Promise<AppSettings>;
  write(settings: AppSettings): Promise<void>;
}

// ── File backend ─────────────────────────────────────────────────────────────

export const fileSettings: SettingsRepo = {
  async get() { return fileReadSettings(); },
  async write(s) { fileWriteSettings(s); },
};

// ── Supabase backend ─────────────────────────────────────────────────────────
// Secrets are injected from env vars, not from DB, so GET /api/settings never exposes them.

function overlayEnvSecrets(base: Partial<AppSettings>): AppSettings {
  return {
    provider: (base.provider ?? "openrouter") as AppSettings["provider"],
    openrouterModel: base.openrouterModel ?? "deepseek/deepseek-v4-flash",
    geminiModel: base.geminiModel ?? "gemini-2.5-flash",
    linkedinCharLimit: base.linkedinCharLimit ?? 200,
    emailLengthGuidance: base.emailLengthGuidance ?? "Aim for 80–130 words. Conversational and direct. No self-introduction opener.",
    whatsappCharLimit: base.whatsappCharLimit ?? 600,
    senderName: base.senderName ?? "",
    defaultLocationLabel: base.defaultLocationLabel ?? "",
    transcriptionProvider: (base.transcriptionProvider ?? "deepgram") as AppSettings["transcriptionProvider"],
    defaultCaptionPreset: base.defaultCaptionPreset ?? "Karaoke",
    defaultAspectRatio: base.defaultAspectRatio ?? "9:16",
    defaultClipLength: base.defaultClipLength ?? "Auto (0-3m)",
    enableSocialPublish: base.enableSocialPublish ?? false,
    editorShortcuts: base.editorShortcuts ?? { ...DEFAULT_SHORTCUTS },
    // Secrets from env (never from DB)
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
    apifyApiToken: process.env.APIFY_API_TOKEN ?? "",
    deepgramApiKey: process.env.DEEPGRAM_API_KEY ?? "",
    assemblyaiApiKey: process.env.ASSEMBLYAI_API_KEY ?? "",
    metaAppId: process.env.META_APP_ID ?? "",
    metaAppSecret: process.env.META_APP_SECRET ?? "",
    ytDlpCookiesBrowser: process.env.YTDLP_COOKIES_BROWSER ?? base.ytDlpCookiesBrowser ?? "",
    ytDlpCookiesText: process.env.YTDLP_COOKIES_TEXT ?? base.ytDlpCookiesText ?? "",
  };
}

export const supabaseSettings: SettingsRepo = {
  async get() {
    const { data, error } = await serverClient()
      .from("app_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error || !data) return overlayEnvSecrets({});
    const r = data as Record<string, unknown>;
    return overlayEnvSecrets({
      provider: r.provider as AppSettings["provider"],
      openrouterModel: r.openrouter_model as string,
      geminiModel: r.gemini_model as string,
      linkedinCharLimit: r.linkedin_char_limit as number,
      emailLengthGuidance: r.email_length_guidance as string,
      whatsappCharLimit: r.whatsapp_char_limit as number,
      senderName: r.sender_name as string,
      defaultLocationLabel: r.default_location_label as string,
      transcriptionProvider: r.transcription_provider as AppSettings["transcriptionProvider"],
      defaultCaptionPreset: r.default_caption_preset as string,
      defaultAspectRatio: r.default_aspect_ratio as string,
      defaultClipLength: r.default_clip_length as string,
      enableSocialPublish: r.enable_social_publish as boolean,
      editorShortcuts: (r.editor_shortcuts as AppSettings["editorShortcuts"]) ?? { ...DEFAULT_SHORTCUTS },
      // yt-dlp cookies may be set via the UI — persisted in DB so they survive deploys.
      ytDlpCookiesText: r.ytdlp_cookies_text as string | undefined,
      ytDlpCookiesBrowser: r.ytdlp_cookies_browser as string | undefined,
    });
  },

  async write(settings) {
    const { error } = await serverClient().from("app_settings").upsert({
      id: 1,
      provider: settings.provider,
      openrouter_model: settings.openrouterModel,
      gemini_model: settings.geminiModel,
      linkedin_char_limit: settings.linkedinCharLimit,
      email_length_guidance: settings.emailLengthGuidance,
      whatsapp_char_limit: settings.whatsappCharLimit,
      sender_name: settings.senderName,
      default_location_label: settings.defaultLocationLabel,
      transcription_provider: settings.transcriptionProvider,
      default_caption_preset: settings.defaultCaptionPreset,
      default_aspect_ratio: settings.defaultAspectRatio,
      default_clip_length: settings.defaultClipLength,
      enable_social_publish: settings.enableSocialPublish,
      editor_shortcuts: settings.editorShortcuts,
      ytdlp_cookies_text: settings.ytDlpCookiesText || null,
      ytdlp_cookies_browser: settings.ytDlpCookiesBrowser || null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
};
