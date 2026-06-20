import { NextResponse } from "next/server";
import { readSettings, writeSettings, type AppSettings } from "@/lib/settings";

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function POST(req: Request) {
  const body = (await req.json()) as AppSettings;
  writeSettings({
    provider: body.provider ?? "openrouter",
    openaiApiKey: body.openaiApiKey ?? "",
    openrouterApiKey: body.openrouterApiKey ?? "",
    openrouterModel: body.openrouterModel ?? "deepseek/deepseek-v4-flash",
    geminiModel: body.geminiModel ?? "gemini-2.0-flash",
    apifyApiToken: body.apifyApiToken ?? "",
    linkedinCharLimit: body.linkedinCharLimit ?? 200,
    emailLengthGuidance: body.emailLengthGuidance ?? "Aim for 80–130 words. Conversational and direct. No self-introduction opener.",
    transcriptionProvider: body.transcriptionProvider ?? "deepgram",
    deepgramApiKey: body.deepgramApiKey ?? "",
    assemblyaiApiKey: body.assemblyaiApiKey ?? "",
    defaultCaptionPreset: body.defaultCaptionPreset ?? "Karaoke",
    defaultAspectRatio: body.defaultAspectRatio ?? "9:16",
    defaultClipLength: body.defaultClipLength ?? "Auto (0-3m)",
    ytDlpCookiesBrowser: body.ytDlpCookiesBrowser ?? "",
    metaAppId: body.metaAppId ?? "",
    metaAppSecret: body.metaAppSecret ?? "",
    enableSocialPublish: body.enableSocialPublish ?? false,
  });
  return NextResponse.json({ ok: true });
}
