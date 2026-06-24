# Add a New Instagram Account — Reusable Guide

Use this every time you want to connect another Instagram account to the app and post reels to it.

The steps are split into two groups. **Part A is done ONCE for the whole app** — skip it if you've already done it. **Part B + C is what you repeat for each new account.**

---

## Part A — One-time app setup (do once, then never again)

You only do this the first time you set up publishing. If your app already connects accounts, Part A is already done — jump to Part B.

### A1. Find your Railway URL
- Go to your project on [railway.app](https://railway.app) → your service → **Settings → Networking/Domains**.
- Copy the public URL. It looks like `https://your-app-name.up.railway.app`.
- Write it here so you don't forget: `https://__________________.up.railway.app`

### A2. Register the callback URL in Meta
- Go to [developers.facebook.com](https://developers.facebook.com) → your app → left sidebar **Instagram → API setup with Instagram login**.
- Open **"Set up Instagram business login" → Business login settings**.
- In **OAuth redirect URIs**, add this EXACTLY (no trailing slash):
  ```
  https://your-app-name.up.railway.app/api/clip/social/callback
  ```
- Save. (If the URL doesn't match exactly, connecting fails with a redirect error.)

### A3. Set APP_URL on Railway
- Railway → your service → **Variables** → add:
  ```
  APP_URL = https://your-app-name.up.railway.app
  ```
- Redeploy (Railway usually redeploys automatically after a variable change).
- Why: this guarantees the login redirect AND the public video URL used for publishing both point at your live HTTPS app. (This is why publishing never works on localhost.)

### A4. Fill in Settings on the live app
- Open `https://your-app-name.up.railway.app/settings` in your browser.
- **Meta App ID** = your **Instagram App ID** (`2008737423349466`).
- **Meta App Secret** = your **Instagram App Secret**.
  - Find both at: Meta console → **Instagram → API setup with Instagram login** (the ID and Secret are shown at the top of that page; click **Show** to reveal the secret). These are the *Instagram* ones, NOT the Facebook app's.
- Turn **Enable social publish** → **ON**.
- Save settings.

✅ Part A complete. You never repeat this unless your Railway URL changes.

---

## Part B — Add a new account (repeat this for EACH account)

### B1. Make the account a Professional account
- On the Instagram app: **Settings → Account type and tools → Switch to professional account** → choose **Business** or **Creator**.
- A Facebook Page is **NOT** required (the app uses Instagram Login).

### B2. Add the account as an Instagram Tester
- Meta console → your app → **App roles → Roles** (or the **Instagram Testers** section) → **Add Instagram Testers** → type the account's Instagram username → send invite.

### B3. Accept the invite (logged in as that account)
- Log into **instagram.com** as that account → **Settings → Apps and websites → Tester invites → Accept**.
- Required while the app is in Development mode — without it, connecting fails.

### B4. Connect it in the app
- Go to `https://your-app-name.up.railway.app/clip/social`.
- Click **Add account**.
- The Instagram login/chooser appears — **log in as the account you want to add** (not whichever account your browser is already logged into).
- Authorize. The account now shows in the **Connected accounts** list. ✅

> Tip: if it keeps grabbing the wrong account, open `/clip/social` in a private/incognito window, or log out of instagram.com first, then add the account.

---

## Part C — Upload / schedule a reel to that account

1. Go to a finished clip (`/clip/[jobId]`) or the editor, and click **Schedule**.
2. In the Accounts list, **select the account(s)** you want to post to (you can pick several).
3. Write a caption or click **Regenerate** to auto-generate one.
4. Click **Publish now** to post immediately, or pick a date/time and click **Schedule**.

Publishing requires: the account is a tester (Part B), **Enable social publish** is ON (A4), and the app is running on Railway over HTTPS (A3).

---

## Quick checklist for a brand-new account

```
[ ] Account switched to Professional (Business/Creator)
[ ] Added as Instagram Tester in Meta console
[ ] Tester invite accepted on instagram.com
[ ] Connected via /clip/social → Add account
[ ] Test post via Schedule → Publish now
```

---

## Troubleshooting

| Problem | Likely cause / fix |
|--------|--------------------|
| "Add account" reconnects the same account | Log out of instagram.com or use an incognito window, then add. |
| Redirect / "URL not allowed" error after login | The callback URL in Meta (A2) doesn't EXACTLY match `https://<railway>/api/clip/social/callback`. |
| Connect fails / "couldn't resolve user" | Account isn't Professional, or the tester invite (B3) wasn't accepted. |
| Publish does nothing or says disabled | **Enable social publish** is OFF in `/settings`, or `APP_URL` isn't set on Railway. |
| Works on Railway but not localhost | Expected — publishing needs public HTTPS. Always use the Railway URL. |
| Account stopped publishing after ~2 months | The access token expired (~60 days). Just reconnect via **Add account**. |

---

## Important limit (read once)

While the app is in **Development mode**, you can only connect and publish to accounts that are **added as testers** (i.e. your own accounts). To post to **clients' accounts** (people who can't be your testers), the app must pass Meta **App Review** for the `instagram_business_content_publish` permission. For your own accounts, the tester route here works without App Review.
