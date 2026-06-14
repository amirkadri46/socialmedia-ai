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
  });
  return NextResponse.json({ ok: true });
}
