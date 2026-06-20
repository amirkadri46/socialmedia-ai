import { NextResponse } from "next/server";
import { readProspectLists } from "@/lib/outreach";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const list = readProspectLists().find((l) => l.id === id);
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(list);
}

export async function HEAD(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const list = readProspectLists().find((l) => l.id === id);
  return new Response(null, { status: list ? 200 : 404 });
}
