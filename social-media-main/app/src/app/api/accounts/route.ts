import { repos } from "@/lib/db";

export async function GET() {
  try {
    const accounts = await repos.socialAccounts.public();
    return Response.json(accounts.map((a) => ({
      id: a.id,
      username: a.username,
      display_name: a.displayName ?? null,
      status: !a.expiresAt || new Date(a.expiresAt) > new Date() ? "connected" : "needs_reauth",
    })));
  } catch {
    return Response.json([]);
  }
}
