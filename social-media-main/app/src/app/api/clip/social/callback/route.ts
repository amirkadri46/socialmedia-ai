import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { v4 as uuid } from "uuid";
import { exchangeCode, fetchIgIdentity } from "@/lib/clip/social/instagram";
import { repos } from "@/lib/db";
import type { SocialAccount } from "@/lib/types";

/** OAuth redirect target: exchange code → resolve IG identity → persist account. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (error) return NextResponse.redirect(`${origin}/clip/social?error=${encodeURIComponent(error)}`);
  if (!code) return NextResponse.redirect(`${origin}/clip/social?error=missing_code`);

  // CSRF: the state in the redirect URL must match the HttpOnly cookie set during /connect.
  const cookieStore = await cookies();
  const storedState = cookieStore.get("oauth_state")?.value;
  if (!storedState || !stateParam || storedState !== stateParam) {
    console.error("[oauth] State mismatch on callback — possible CSRF attempt or stale session");
    return NextResponse.redirect(`${origin}/clip/social?error=invalid_state`);
  }

  try {
    const settings = await repos.settings.get();
    const accessToken = await exchangeCode(origin, code, settings.metaAppId, settings.metaAppSecret);
    const ig = await fetchIgIdentity(accessToken);
    const accounts = await repos.socialAccounts.getAll();
    const existing = accounts.find((a) => a.igUserId === ig.igUserId);
    // IG long-lived tokens are valid for ~60 days. Always compute a fresh expiry
    // from the current time so reconnecting an account doesn't preserve a stale date.
    const freshExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const account: SocialAccount = {
      id: existing?.id ?? uuid(),
      platform: "instagram",
      displayName: ig.displayName,
      username: ig.username,
      avatarUrl: ig.avatarUrl,
      accessToken,
      igUserId: ig.igUserId,
      pageId: ig.pageId,
      expiresAt: freshExpiresAt,
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
    };
    await repos.socialAccounts.upsert(account);
    console.log(`[oauth] Instagram account connected: @${ig.username} (${ig.igUserId})`);
    const reconnected = Boolean(existing);
    const response = NextResponse.redirect(
      `${origin}/clip/social?connected=${encodeURIComponent(ig.username)}${reconnected ? "&reconnected=1" : ""}`
    );
    // Clear the one-time state cookie — it must not be reusable.
    response.cookies.delete("oauth_state");
    return response;
  } catch (err) {
    console.error("[oauth] Callback error:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(
      `${origin}/clip/social?error=${encodeURIComponent(safeOAuthError(err))}`
    );
  }
}

/**
 * Return a user-facing error string without leaking internal details.
 * Instagram API errors are already user-readable; everything else gets a generic message.
 */
function safeOAuthError(err: unknown): string {
  if (!(err instanceof Error)) return "OAuth failed. Please try again.";
  const { message } = err;
  if (
    message.startsWith("Token exchange failed") ||
    message.startsWith("Failed to fetch IG identity") ||
    message.startsWith("Could not resolve Instagram") ||
    message.startsWith("Instagram App ID")
  ) {
    return message;
  }
  return "Failed to connect Instagram account. Please try again.";
}
