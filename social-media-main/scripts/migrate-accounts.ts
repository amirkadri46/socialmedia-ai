/**
 * Migrates existing Instagram accounts from data/social-accounts.json into
 * the Supabase instagram_accounts table.
 *
 * Run from the app/ directory:
 *   cd app && npx tsx ../scripts/migrate-accounts.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ../.env
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const ENV_PATH = path.join(__dirname, "..", ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ACCOUNTS_PATH = path.join(__dirname, "..", "data", "social-accounts.json");

interface SocialAccount {
  id: string;
  platform: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  accessToken: string;
  igUserId?: string;
  pageId?: string;
  expiresAt?: string;
  connectedAt: string;
}

async function main() {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    console.log("No accounts to migrate (data/social-accounts.json not found)");
    return;
  }

  let accounts: SocialAccount[];
  try {
    accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, "utf8")) as SocialAccount[];
  } catch {
    console.error("❌  Failed to parse social-accounts.json");
    process.exit(1);
  }

  const instagramAccounts = accounts.filter((a) => a.platform === "instagram" && a.igUserId);

  if (instagramAccounts.length === 0) {
    console.log("No Instagram accounts to migrate");
    return;
  }

  let migrated = 0;
  for (const account of instagramAccounts) {
    const row = {
      ig_user_id: account.igUserId!,
      username: account.username,
      display_name: account.displayName || null,
      access_token: account.accessToken,
      token_expires_at: account.expiresAt || null,
      status: "connected" as const,
      last_posted_at: null,
    };
    const { error } = await db
      .from("pub_instagram_accounts")
      .upsert(row, { onConflict: "ig_user_id" });
    if (error) {
      console.error(`❌  Failed to migrate ${account.username}: ${error.message}`);
    } else {
      migrated++;
      console.log(`  ✓ ${account.username} (${account.igUserId})`);
    }
  }

  console.log(`\nMigrated ${migrated} accounts`);
}

main().catch((err) => {
  console.error("❌ ", err);
  process.exit(1);
});
