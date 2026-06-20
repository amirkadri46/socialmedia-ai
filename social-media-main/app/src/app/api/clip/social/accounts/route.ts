import { NextResponse } from "next/server";
import { publicAccounts, readAccounts, writeAccounts } from "@/lib/clip/store";

/** List connected accounts (tokens stripped). */
export async function GET() {
  return NextResponse.json(publicAccounts());
}

/** Disconnect an account by id. */
export async function DELETE(request: Request) {
  const { id } = (await request.json()) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  writeAccounts(readAccounts().filter((a) => a.id !== id));
  return NextResponse.json({ ok: true });
}
