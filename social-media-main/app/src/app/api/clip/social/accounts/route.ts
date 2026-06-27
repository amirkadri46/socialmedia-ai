import { NextResponse } from "next/server";
import { repos } from "@/lib/db";

/** List connected accounts (tokens stripped). */
export async function GET() {
  return NextResponse.json(await repos.socialAccounts.public());
}

/** Disconnect an account by id. */
export async function DELETE(request: Request) {
  const { id } = (await request.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await repos.socialAccounts.delete(id);
  return NextResponse.json({ ok: true });
}
