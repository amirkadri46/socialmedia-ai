import { supabase } from "./lib/supabase";

export async function runTokenRefreshTick(): Promise<void> {
  // finding #5: outer try-catch matches pattern of the other two tick functions;
  // prevents an unhandled rejection from the initial SELECT from killing the process
  try {
    const threshold = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();

    const { data: accounts } = await supabase
      .from("instagram_accounts")
      .select("id, access_token")
      .eq("status", "connected")
      .lt("token_expires_at", threshold);

    for (const account of accounts ?? []) {
      try {
        const res = await fetch(
          `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${account.access_token}`
        );
        const data = await res.json();

        if (data.access_token) {
          const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
          await supabase.from("instagram_accounts").update({
            access_token: data.access_token,
            token_expires_at: expiresAt,
          }).eq("id", account.id);
          console.log(`[TokenRefresh] Refreshed token for account ${account.id}`);
        } else {
          throw new Error(JSON.stringify(data));
        }
      } catch (err) {
        console.error(`[TokenRefresh] Failed for account ${account.id}:`, err);
        await supabase.from("instagram_accounts")
          .update({ status: "needs_reauth" })
          .eq("id", account.id);
      }
    }
  } catch (err) {
    console.error("[TokenRefresh] Tick error:", err);
  }
}
