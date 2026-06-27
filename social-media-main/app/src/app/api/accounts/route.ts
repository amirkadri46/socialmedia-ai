import { repos } from "@/lib/db";

export async function GET() {
  try {
    const accounts = await repos.socialAccounts.public();
    return Response.json(accounts.map((a) => ({ id: a.id, username: a.username })));
  } catch {
    return Response.json([]);
  }
}
