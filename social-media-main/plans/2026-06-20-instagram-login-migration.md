# Migrate Social Auth: Facebook Login → Instagram Login

**Why:** The Facebook Login flow requires every Instagram account to be linked to a Facebook Page — painful for multi-account agency use. Instagram Login lets users connect any Professional/Creator IG account directly, no Facebook Page needed.

---

## Meta Developer Console (manual steps before coding)

1. Go to your app at developers.facebook.com → **Use cases → Customize → API setup with Instagram login**
2. Click **"Add required messaging permissions"** button (the content permissions are already added)
3. In the left sidebar under **Instagram API → API setup with Instagram login**, scroll to the redirect URI field and add:
   `http://localhost:3000/api/clip/social/callback`
4. Save.
5. Note the **Instagram App ID** (`2008737423349466`) and **Instagram App Secret** (click Show) from the top of that page — these are DIFFERENT from the Facebook App ID/Secret already in settings.
6. In your app's Settings page (`/settings`), update **Meta App ID** to `2008737423349466` and **Meta App Secret** to the Instagram app secret you just revealed.

---

## Code Changes

### 1. `app/src/lib/clip/social/instagram.ts` — full replacement

Replace the entire file with this Instagram Login implementation:

```typescript
import { readSettings } from "../../settings";

// Instagram Login flow — no Facebook Page required.
// Uses api.instagram.com for OAuth + graph.instagram.com for API calls.

const IG_GRAPH = "https://graph.instagram.com/v21.0";

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
];

export function getRedirectUri(origin: string): string {
  return `${origin}/api/clip/social/callback`;
}

/** Build the Instagram OAuth consent URL. */
export function buildAuthUrl(origin: string, state: string): string {
  const { metaAppId } = readSettings();
  if (!metaAppId) throw new Error("Meta App ID is not set — add it in Settings before connecting.");
  const params = new URLSearchParams({
    client_id: metaAppId,
    redirect_uri: getRedirectUri(origin),
    scope: SCOPES.join(","),
    response_type: "code",
    state,
  });
  return `https://api.instagram.com/oauth/authorize?${params}`;
}

/** Exchange an OAuth code for a long-lived access token. */
export async function exchangeCode(origin: string, code: string): Promise<string> {
  const { metaAppId, metaAppSecret } = readSettings();
  if (!metaAppId || !metaAppSecret) throw new Error("Meta App ID/Secret not configured.");

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
  const { metaAppSecret: secret } = readSettings();
  const longRes = await fetch(
    `https://graph.instagram.com/access_token?` +
      new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_secret: secret,
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
        fields: "id,username,name,profile_picture_url",
        access_token: accessToken,
      })
  );
  if (!res.ok) throw new Error(`Failed to fetch IG identity: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.id) throw new Error("Could not resolve Instagram user. Make sure the account is Professional/Creator.");
  return {
    igUserId: data.id,
    pageId: data.id, // no Facebook Page needed; reuse igUserId for pageId field
    username: data.username ?? "",
    displayName: data.name ?? data.username ?? "",
    avatarUrl: data.profile_picture_url,
  };
}

/**
 * Publish a Reel via Instagram Content Publishing API.
 * videoUrl must be a publicly accessible HTTPS URL.
 * Requires settings.mediaPublicBaseUrl to host the mp4.
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
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(
      `${IG_GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const status = await statusRes.json();
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR") throw new Error("Media container processing errored.");
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
```

### 2. `app/src/app/api/clip/social/callback/route.ts` — no changes needed

The callback route already works correctly. The `pageId` field will now just hold the igUserId (same value) since Instagram Login doesn't involve Pages. No edit required.

### 3. `app/src/app/api/clip/social/connect/route.ts` — no changes needed

Already calls `buildAuthUrl` which we've updated. No edit required.

---

## Settings Page Update (`app/src/app/settings/page.tsx`)

Find the Meta App ID / Meta App Secret labels and update their helper text to clarify these are now the **Instagram** App ID/Secret (not Facebook). This is cosmetic only — the field names `metaAppId` / `metaAppSecret` stay the same.

Search for any label text like "Meta App ID" or "Facebook App" and change description text to:
- "Instagram App ID (from Meta Developer Console → your app → API setup with Instagram login)"
- "Instagram App Secret (from the same page, click Show)"

---

## Testing After Implementation

1. Make sure `metaAppId` in Settings = `2008737423349466` (Instagram App ID)
2. Make sure `metaAppSecret` in Settings = the Instagram App Secret (NOT the Facebook one)
3. Go to `/clip/social` → click **Add account**
4. Should redirect to `api.instagram.com/oauth/authorize` (not facebook.com)
5. Log in with Instagram credentials directly — no Facebook Page selection screen
6. Should redirect back and show the account connected

---

## What Changes / What Stays the Same

| Thing | Before | After |
|-------|--------|-------|
| OAuth URL | facebook.com/dialog/oauth | api.instagram.com/oauth/authorize |
| Token exchange | graph.facebook.com | api.instagram.com/oauth/access_token |
| Long-lived token | fb_exchange_token | ig_exchange_token via graph.instagram.com |
| API base | graph.facebook.com/v21.0 | graph.instagram.com/v21.0 |
| App ID used | Facebook App ID (1330500435875346) | Instagram App ID (2008737423349446) |
| Requires FB Page | Yes | No |
| Publish endpoint | /{igUserId}/media | /{igUserId}/media (same path, different base URL) |
| SocialAccount type | unchanged | unchanged (pageId reuses igUserId) |
| Callback route | unchanged | unchanged |
| Connect route | unchanged | unchanged |
| Settings fields | metaAppId / metaAppSecret | metaAppId / metaAppSecret (same keys, new values) |
