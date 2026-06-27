import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildAuthUrl } from "@/lib/clip/social/instagram";
import { repos } from "@/lib/db";

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
    const settings = await repos.settings.get();
    // Cryptographically random state — stored in an HttpOnly cookie so the callback
    // can verify it matches, preventing CSRF on the OAuth redirect.
    const state = randomBytes(16).toString("hex");
    const response = NextResponse.redirect(buildAuthUrl(origin, state, settings.metaAppId));
    response.cookies.set("oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600, // 10 minutes — enough for any OAuth round-trip
      path: "/",
    });
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start OAuth.";
    return NextResponse.redirect(`${origin}/clip/social?error=${encodeURIComponent(msg)}`);
  }
}
