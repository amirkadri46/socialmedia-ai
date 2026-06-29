import type { AppSettings } from "@/lib/settings";
import { readSettings as fileReadSettings, writeSettings as fileWriteSettings } from "@/lib/settings";
import { DEFAULT_SHORTCUTS } from "@/lib/clip/shortcuts";
import { serverClient } from "../client";

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
// GET /api/settings redacts these before they reach the browser.

function overlayEnvSecrets(base: Partial<AppSettings>): AppSettings {
  return {
    provider: (base.provider ?? "openrouter") as AppSettings["provider"],
    openaiModel: base.openaiModel ?? "gpt-4o",
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
    // Settings UI wins; env vars are the fallback for fresh deploys.
    openaiApiKey: base.openaiApiKey ?? process.env.OPENAI_API_KEY ?? "",
    openrouterApiKey: base.openrouterApiKey ?? process.env.OPENROUTER_API_KEY ?? "",
    apifyApiToken: base.apifyApiToken ?? process.env.APIFY_API_TOKEN ?? "",
    deepgramApiKey: base.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? "",
    assemblyaiApiKey: base.assemblyaiApiKey ?? process.env.ASSEMBLYAI_API_KEY ?? "",
    metaAppId: base.metaAppId ?? process.env.META_APP_ID ?? "",
    metaAppSecret: base.metaAppSecret ?? process.env.META_APP_SECRET ?? "",
    ytDlpCookiesBrowser: base.ytDlpCookiesBrowser ?? process.env.YTDLP_COOKIES_BROWSER ?? "",
    ytDlpCookiesText: base.ytDlpCookiesText ?? process.env.YTDLP_COOKIES_TEXT ?? "",
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
      openaiModel: r.openai_model as string,
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
      ytDlpCookiesText: r.ytdlp_cookies_text as string | undefined,
      ytDlpCookiesBrowser: r.ytdlp_cookies_browser as string | undefined,
      // Secrets stored in DB (env vars take priority via overlayEnvSecrets)
      openaiApiKey: r.openai_api_key as string | undefined,
      openrouterApiKey: r.openrouter_api_key as string | undefined,
      apifyApiToken: r.apify_api_token as string | undefined,
      deepgramApiKey: r.deepgram_api_key as string | undefined,
      assemblyaiApiKey: r.assemblyai_api_key as string | undefined,
      metaAppId: r.meta_app_id as string | undefined,
      metaAppSecret: r.meta_app_secret as string | undefined,
    });
  },

  async write(settings) {
    const { error } = await serverClient().from("app_settings").upsert({
      id: 1,
      provider: settings.provider,
      openai_model: settings.openaiModel,
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
      openai_api_key: settings.openaiApiKey || null,
      openrouter_api_key: settings.openrouterApiKey || null,
      apify_api_token: settings.apifyApiToken || null,
      deepgram_api_key: settings.deepgramApiKey || null,
      assemblyai_api_key: settings.assemblyaiApiKey || null,
      meta_app_id: settings.metaAppId || null,
      meta_app_secret: settings.metaAppSecret || null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
};
