import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/clip/social/instagram";

/** Kick off the Meta OAuth flow for a platform (instagram in v1). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") || "instagram";
  const origin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || url.origin;
  try {
    if (platform !== "instagram") {
      return NextResponse.json(
        { error: `Platform "${platform}" is not supported yet.` },
        { status: 400 }
      );
    }
    const state = Buffer.from(JSON.stringify({ platform, ts: Date.now() })).toString("base64url");
    return NextResponse.redirect(buildAuthUrl(origin, state));
  } catch (err) {
    // Surface a clear error back to the social page.
    const msg = err instanceof Error ? err.message : "Failed to start OAuth.";
    return NextResponse.redirect(`${origin}/clip/social?error=${encodeURIComponent(msg)}`);
  }
}
