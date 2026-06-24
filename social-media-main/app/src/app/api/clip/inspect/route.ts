import { NextResponse } from "next/server";
import { inspect } from "@/lib/clip/download";
import { readSettings } from "@/lib/settings";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };
    if (!url || !/^https?:\/\//.test(url)) {
      return NextResponse.json({ error: "A valid http(s) URL is required." }, { status: 400 });
    }
    const { ytDlpCookiesBrowser, ytDlpCookiesText } = readSettings();
    const meta = await inspect(url, ytDlpCookiesBrowser || undefined, ytDlpCookiesText || undefined);
    return NextResponse.json(meta);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to inspect URL." },
      { status: 500 }
    );
  }
}
