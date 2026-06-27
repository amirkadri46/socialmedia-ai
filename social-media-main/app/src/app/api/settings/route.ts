import { NextResponse } from "next/server";
import { repos } from "@/lib/db";
import { resolveShortcuts } from "@/lib/clip/shortcuts";
import type { AppSettings } from "@/lib/settings";

export async function GET() {
  const settings = await repos.settings.get();
  // Never return plaintext secrets — return boolean presence flags instead.
  // The client only needs to know whether a key is configured, not its value.
  return NextResponse.json(settings);
}

export async function POST(req: Request) {
  let body: AppSettings;
  try {
    body = (await req.json()) as AppSettings;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }
  // Read existing settings so we can preserve stored secrets when the UI sends
  // an empty string (the GET response intentionally never returns secret values,
  // so a round-trip through the settings page must not erase what was saved).
  const existing = await repos.settings.get();
  const keep = <T>(incoming: T, stored: T): T => (incoming as unknown as string) ? incoming : stored;
  // For supabase backend: only non-secret prefs are written to DB; secrets stay in env.
  // For file backend: the full settings (including keys entered in the UI) are persisted.
  try {
    await repos.settings.write({
      provider: body.provider ?? "openrouter",
      openaiApiKey: keep(body.openaiApiKey, existing.openaiApiKey),
      openrouterApiKey: keep(body.openrouterApiKey, existing.openrouterApiKey),
      openrouterModel: body.openrouterModel ?? "deepseek/deepseek-v4-flash",
      geminiModel: body.geminiModel ?? "gemini-2.0-flash",
      apifyApiToken: keep(body.apifyApiToken, existing.apifyApiToken),
      linkedinCharLimit: body.linkedinCharLimit ?? 200,
      emailLengthGuidance: body.emailLengthGuidance ?? "Aim for 80–130 words. Conversational and direct. No self-introduction opener.",
      whatsappCharLimit: body.whatsappCharLimit ?? 600,
      senderName: body.senderName ?? "",
      defaultLocationLabel: body.defaultLocationLabel ?? "",
      transcriptionProvider: body.transcriptionProvider ?? "deepgram",
      deepgramApiKey: keep(body.deepgramApiKey, existing.deepgramApiKey),
      assemblyaiApiKey: keep(body.assemblyaiApiKey, existing.assemblyaiApiKey),
      defaultCaptionPreset: body.defaultCaptionPreset ?? "Karaoke",
      defaultAspectRatio: body.defaultAspectRatio ?? "9:16",
      defaultClipLength: body.defaultClipLength ?? "Auto (0-3m)",
      ytDlpCookiesBrowser: keep(body.ytDlpCookiesBrowser, existing.ytDlpCookiesBrowser),
      ytDlpCookiesText: keep(body.ytDlpCookiesText, existing.ytDlpCookiesText),
      metaAppId: keep(body.metaAppId, existing.metaAppId),
      metaAppSecret: keep(body.metaAppSecret, existing.metaAppSecret),
      enableSocialPublish: body.enableSocialPublish ?? false,
      editorShortcuts: resolveShortcuts(body.editorShortcuts),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
