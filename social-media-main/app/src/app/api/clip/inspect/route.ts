import { NextResponse } from "next/server";
import { inspect } from "@/lib/clip/download";
import { repos } from "@/lib/db";
import { assertPublicHttpUrl } from "@/lib/security/url";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };
    const safeUrl = await assertPublicHttpUrl(url);
    const { ytDlpCookiesBrowser, ytDlpCookiesText } = await repos.settings.get();
    const meta = await inspect(safeUrl, ytDlpCookiesBrowser || undefined, ytDlpCookiesText || undefined);
    return NextResponse.json(meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to inspect URL.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("URL") ? 400 : 500 }
    );
  }
}
