import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { exchangeCode, fetchIgIdentity } from "@/lib/clip/social/instagram";
import { readAccounts, upsertAccount } from "@/lib/clip/store";
import type { SocialAccount } from "@/lib/types";

/** OAuth redirect target: exchange code → resolve IG identity → persist account. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (error) return NextResponse.redirect(`${origin}/clip/social?error=${encodeURIComponent(error)}`);
  if (!code) return NextResponse.redirect(`${origin}/clip/social?error=missing_code`);

  try {
    const accessToken = await exchangeCode(origin, code);
    const ig = await fetchIgIdentity(accessToken);
    const existing = readAccounts().find((a) => a.igUserId === ig.igUserId);
    const account: SocialAccount = {
      id: existing?.id ?? uuid(),
      platform: "instagram",
      displayName: ig.displayName,
      username: ig.username,
      avatarUrl: ig.avatarUrl,
      accessToken,
      igUserId: ig.igUserId,
      pageId: ig.pageId,
      expiresAt: existing?.expiresAt,
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
    };
    upsertAccount(account);
    const reconnected = Boolean(existing);
    return NextResponse.redirect(
      `${origin}/clip/social?connected=${encodeURIComponent(ig.username)}${reconnected ? "&reconnected=1" : ""}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth callback failed.";
    return NextResponse.redirect(`${origin}/clip/social?error=${encodeURIComponent(msg)}`);
  }
}
