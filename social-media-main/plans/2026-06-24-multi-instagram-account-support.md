# Add Multiple Instagram Accounts (Multi-Account Support)

**Goal:** Let the user connect several Instagram accounts, manage them, and publish/schedule a clip to any subset of them. The Instagram Login migration (`plans/2026-06-20-instagram-login-migration.md`) is already done — this builds the full multi-account UX on top of it.

**Target environment:** the **live Railway deployment** (HTTPS), **not** localhost. Instagram OAuth and publishing require a public HTTPS callback + media URL, which only the Railway URL provides. All testing happens against the deployed app.

---

## What Already Works (do NOT rebuild)

- `lib/clip/store.ts` already stores an **array** of accounts (`readAccounts`, `writeAccounts`, `upsertAccount`, `publicAccounts`) in `data/social-accounts.json`.
- `/clip/social` (`app/clip/social/page.tsx`) already lists accounts and has **Add account** + disconnect.
- `POST /api/clip/social/schedule` already accepts `accountIds: string[]` and publishes to **multiple** accounts in one call.
- `components/clip/schedule-modal.tsx` already has a **multi-select** account picker (defaults to all selected).
- `lib/clip/social/instagram.ts` already uses Instagram Login (`instagram.com/oauth/authorize`, `graph.instagram.com`, `ig_exchange_token`).

So the plumbing exists. The work below fixes the **two real bugs that block adding a second account** and adds the polish that makes managing many accounts pleasant.

---

## The Two Blocking Bugs (must fix)

### Bug 1 — "Add account" can't connect a *different* account
`instagram.com/oauth/authorize` reuses the browser's existing Instagram web session, so clicking **Add account** while already logged into IG silently re-authorizes the **same** account. To connect a different account the user has to manually log out of instagram.com first.

**Fix:** force the Instagram account chooser by adding `force_reauth=true` to the authorize URL.

`app/src/lib/clip/social/instagram.ts` — in `buildAuthUrl`, add the param:

```typescript
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
```

### Bug 2 — reconnecting an account creates duplicates
`app/src/app/api/clip/social/callback/route.ts` assigns `id: uuid()` on **every** callback, and `upsertAccount` (`store.ts`) dedupes on that `id`. So reconnecting the same IG account (or refreshing an expired token) inserts a **second** row instead of updating the existing one.

**Fix:** dedupe by the stable `igUserId`. Two coordinated changes:

**(a) `app/src/lib/clip/store.ts` — `upsertAccount` dedupes by `igUserId` (falling back to `id`):**

```typescript
export function upsertAccount(account: SocialAccount): void {
  const accounts = readAccounts();
  const idx = accounts.findIndex(
    (a) =>
      (account.igUserId && a.igUserId === account.igUserId) || a.id === account.id
  );
  if (idx >= 0) {
    // Preserve the original id/connectedAt; refresh token + profile fields.
    accounts[idx] = { ...accounts[idx], ...account, id: accounts[idx].id, connectedAt: accounts[idx].connectedAt };
  } else {
    accounts.push(account);
  }
  writeAccounts(accounts);
}
```

**(b) `app/src/app/api/clip/social/callback/route.ts` — reuse the existing id when the IG user is already connected** (so the stored `id` stays stable and the UI doesn't flicker a new row):

```typescript
import { readAccounts, upsertAccount } from "@/lib/clip/store";
// ...
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
  expiresAt: existing?.expiresAt, // (optional) keep if you later compute token expiry
  connectedAt: existing?.connectedAt ?? new Date().toISOString(),
};
upsertAccount(account);
const reconnected = Boolean(existing);
return NextResponse.redirect(
  `${origin}/clip/social?connected=${encodeURIComponent(ig.username)}${reconnected ? "&reconnected=1" : ""}`
);
```

---

## Profile Fields for the UI (avatars + display name)

`fetchIgIdentity` currently requests only `id,username,account_type` because `name`/`profile_picture_url` aren't returned for every account type and would error the whole request. To show avatars and real names without that risk, do a **second, lenient** fetch.

`app/src/lib/clip/social/instagram.ts` — in `fetchIgIdentity`, after resolving the base identity, attempt the richer fields and ignore failures:

```typescript
export async function fetchIgIdentity(accessToken: string): Promise<IgIdentity> {
  const res = await fetch(
    `${IG_GRAPH}/me?` +
      new URLSearchParams({ fields: "id,username,account_type", access_token: accessToken })
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
  } catch { /* ignore — optional fields */ }

  return {
    igUserId: data.id,
    pageId: data.id,
    username: data.username ?? "",
    displayName,
    avatarUrl,
  };
}
```

---

## UI Polish — `/clip/social` (account management)

`app/src/app/clip/social/page.tsx`:

1. **Avatars:** render `a.avatarUrl` in an `Avatar` (`@/components/ui/avatar`, which already exists) with the Instagram icon as fallback.
2. **Account count:** show "Connected accounts (N)" in the card header.
3. **Connected date:** show `connectedAt` formatted (e.g. "Connected Jun 24, 2026") under the username.
4. **Confirm on disconnect:** wrap the trash button in an `AlertDialog` ("Disconnect @username? You can reconnect anytime.") so a misclick doesn't silently drop an account.
5. **Reconnected toast:** handle the new `?reconnected=1` query param — show "Reconnected @username (token refreshed)" instead of "Connected".
6. **Helper text:** under "Add account", add a one-line hint: *"You'll be asked to log in — switch to the Instagram account you want to add before authorizing."* (because `force_reauth` now always shows the chooser).

Keep it within the existing shadcn card; no new layout system.

## UI Polish — `components/clip/schedule-modal.tsx` (per-clip picker)

The multi-select already works. Add:

1. **Select all / none** control above the account list (small text buttons) — useful once there are many accounts.
2. **Avatars** in each account button (reuse `avatarUrl`).
3. **Summary line:** "Publishing to N account(s)" under the list so it's obvious how many targets are selected.
4. When `accounts.length === 0`, the existing "Connect an account" link stays.

No change to the request shape — it already sends `accountIds: string[]`.

---

## Production / Railway Setup (required for any of this to work)

Instagram OAuth + publishing only work over public HTTPS, so everything is tested on the **Railway** URL.

1. **Register the Railway callback in the Instagram app** (Meta Developer Console → your app → **Instagram → API setup with Instagram login** → OAuth redirect URIs). Add exactly:
   `https://<your-app>.up.railway.app/api/clip/social/callback`
   (Replace with the real Railway public domain. Keep the localhost one too if you ever test locally with a tunnel.)
2. **Env on Railway:** set `APP_URL=https://<your-app>.up.railway.app` (the connect/callback/schedule routes prefer `APP_URL`/`NEXT_PUBLIC_APP_URL` over the request origin — this guarantees the redirect URI and the public media URL match what's registered). Redeploy after setting it.
3. **Settings page** (`/settings` on the live app): `metaAppId` = the **Instagram** App ID (`2008737423349466`), `metaAppSecret` = the Instagram App Secret. These are the Instagram ones, not the Facebook app's.
4. **Accounts to add must be Professional or Creator** Instagram accounts (personal accounts can't use the publishing API).
5. **Publishing stays gated** by `enableSocialPublish` in Settings until the Meta app passes App Review. Connecting multiple accounts, scheduling, and caption generation all work before that; only live "Publish now" is gated. To publish to accounts other than your own logged-in testers, the app needs App Review for `instagram_business_content_publish`.

---

## Testing (on the live Railway app)

1. Deploy with the changes + `APP_URL` set.
2. `/clip/social` → **Add account** → authorize **Account A** → it appears with avatar + connected date.
3. **Add account** again → because of `force_reauth`, the IG login/chooser appears → log in as **Account B** → it appears as a **second** row (not replacing A).
4. **Add account** and re-authorize **Account A** again → it should **update in place** (no duplicate), and the page shows the "reconnected" notice.
5. Disconnect **Account B** via the confirm dialog → only B is removed.
6. Open a clip → **Schedule** → both accounts listed, select-all/none works, "Publishing to N accounts" updates.
7. With `enableSocialPublish` ON (post-App-Review) → **Publish now** to a multi-selection → each account gets its own `ScheduledPost` result.
8. `npm run build` is green.

---

## Files Touched

| File | Change |
|------|--------|
| `app/src/lib/clip/social/instagram.ts` | `force_reauth=true` in `buildAuthUrl`; lenient avatar/name enrichment in `fetchIgIdentity` |
| `app/src/lib/clip/store.ts` | `upsertAccount` dedupes by `igUserId` |
| `app/src/app/api/clip/social/callback/route.ts` | reuse existing account id by `igUserId`; `&reconnected=1` redirect flag |
| `app/src/app/clip/social/page.tsx` | avatars, count, connected date, confirm-on-disconnect, reconnected toast, hint text |
| `app/src/components/clip/schedule-modal.tsx` | select all/none, avatars, "Publishing to N accounts" summary |
| Meta Console + Railway env | register Railway callback URI; set `APP_URL` |

No data migration needed — existing `social-accounts.json` rows already have `igUserId`. No `SocialAccount` type change.

---

## Implementation Order (work top-down, build after each)

1. Bug fixes first (`instagram.ts` force_reauth, `store.ts` dedupe, `callback` id reuse) — this alone makes multi-account work.
2. Avatar enrichment in `fetchIgIdentity`.
3. `/clip/social` UI polish.
4. `schedule-modal.tsx` picker polish.
5. `npm run build`, then test against Railway per the checklist.
