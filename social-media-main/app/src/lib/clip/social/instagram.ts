import { readSettings } from "../../settings";

// Instagram Login flow — no Facebook Page required.
// Uses api.instagram.com for OAuth + graph.instagram.com for API calls.

const IG_GRAPH = "https://graph.instagram.com/v21.0";

const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];

export function getRedirectUri(origin: string): string {
  return `${origin}/api/clip/social/callback`;
}

/** Build the Instagram OAuth consent URL. */
export function buildAuthUrl(origin: string, state: string): string {
  const { metaAppId } = readSettings();
  if (!metaAppId) throw new Error("Instagram App ID is not set — add it in Settings before connecting.");
  const params = new URLSearchParams({
    client_id: metaAppId,
    redirect_uri: getRedirectUri(origin),
    scope: SCOPES.join(","),
    response_type: "code",
    state,
    force_reauth: "true", // always show the IG login/account chooser so a different account can be added
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

/** Exchange an OAuth code for a long-lived access token. */
export async function exchangeCode(origin: string, code: string): Promise<string> {
  const { metaAppId, metaAppSecret } = readSettings();
  if (!metaAppId || !metaAppSecret) throw new Error("Instagram App ID/Secret not configured.");

  // Step 1: short-lived token
  const form = new URLSearchParams({
    client_id: metaAppId,
    client_secret: metaAppSecret,
    grant_type: "authorization_code",
    redirect_uri: getRedirectUri(origin),
    code,
  });
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: form,
  });
  if (!shortRes.ok) throw new Error(`Token exchange failed: ${(await shortRes.text()).slice(0, 200)}`);
  const { access_token: shortToken } = await shortRes.json();

  // Step 2: exchange for long-lived token (~60 days)
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?` +
      new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: metaAppSecret,
        access_token: shortToken,
      })
  );
  if (!longRes.ok) return shortToken;
  const { access_token: longToken } = await longRes.json();
  return longToken || shortToken;
}

export interface IgIdentity {
  igUserId: string;
  pageId: string; // kept for SocialAccount type compatibility; set to igUserId
  username: string;
  displayName: string;
  avatarUrl?: string;
}

/** Fetch the IG user's identity using the access token. */
export async function fetchIgIdentity(accessToken: string): Promise<IgIdentity> {
  const res = await fetch(
    `${IG_GRAPH}/me?` +
      new URLSearchParams({
        // Keep to the always-available fields — name/profile_picture_url aren't
        // returned for every account type and would error the whole request.
        fields: "id,username,account_type",
        access_token: accessToken,
      })
  );
  if (!res.ok) throw new Error(`Failed to fetch IG identity: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.id) throw new Error("Could not resolve Instagram user. Make sure the account is Professional/Creator.");

  // Lenient enrichment — never fail the connect over these.
  let displayName = data.username ?? "";
  let avatarUrl: string | undefined;
  try {
    const rich = await fetch(
      `${IG_GRAPH}/me?` +
        new URLSearchParams({ fields: "name,profile_picture_url", access_token: accessToken })
    );
    if (rich.ok) {
      const r = await rich.json();
      displayName = r.name || displayName;
      avatarUrl = r.profile_picture_url || undefined;
    }
  } catch {
    /* ignore — optional fields */
  }

  return {
    igUserId: data.id,
    pageId: data.id,
    username: data.username ?? "",
    displayName,
    avatarUrl,
  };
}

/**
 * Publish a Reel via Instagram Content Publishing API.
 * videoUrl must be a publicly accessible HTTPS URL.
 */
export async function publishReel(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  caption: string
): Promise<{ mediaId: string }> {
  const createRes = await fetch(`${IG_GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      access_token: accessToken,
    }),
  });
  if (!createRes.ok) throw new Error(`Container create failed: ${(await createRes.text()).slice(0, 200)}`);
  const { id: containerId } = await createRes.json();

  // Poll container status (video transcode can take a while)
  let finished = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(
      `${IG_GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const status = await statusRes.json();
    if (status.status_code === "FINISHED") { finished = true; break; }
    if (status.status_code === "ERROR") throw new Error("Media container processing errored.");
  }
  // Never publish a container that didn't finish transcoding — Instagram would reject it
  // and (worse) the caller couldn't distinguish a real timeout from success.
  if (!finished) {
    throw new Error("Media processing timed out before it finished — please try again.");
  }

  const pubRes = await fetch(`${IG_GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  });
  if (!pubRes.ok) throw new Error(`Publish failed: ${(await pubRes.text()).slice(0, 200)}`);
  const { id: mediaId } = await pubRes.json();
  return { mediaId };
}
