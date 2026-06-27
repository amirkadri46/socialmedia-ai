import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { repos } from "@/lib/db";
import { scrapeCreatorStats } from "@/lib/apify";
import type { Creator } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const creators = await repos.creators.getAll(category);
  return NextResponse.json(creators);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.username || !body.category) {
      return NextResponse.json({ error: "Username and category are required" }, { status: 400 });
    }

    const newCreator: Creator = {
      id: uuid(),
      username: body.username,
      category: body.category,
      profilePicUrl: "",
      followers: 0,
      reelsCount30d: 0,
      avgViews30d: 0,
      lastScrapedAt: "",
    };

    // Save immediately so the UI sees the new row right away
    await repos.creators.upsertByUsername(newCreator);

    // Try to scrape stats (non-blocking for the response)
    try {
      const stats = await scrapeCreatorStats(body.username);
      const withStats: Creator = {
        ...newCreator,
        profilePicUrl: stats.profilePicUrl,
        followers: stats.followers,
        reelsCount30d: stats.reelsCount30d,
        avgViews30d: stats.avgViews30d,
        lastScrapedAt: new Date().toISOString(),
      };
      await repos.creators.upsertByUsername(withStats);
      return NextResponse.json(withStats, { status: 201 });
    } catch (err) {
      console.error(`Failed to scrape stats for @${body.username}:`, err);
    }

    return NextResponse.json(newCreator, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: "ID required" }, { status: 400 });
    const creators = await repos.creators.getAll();
    const existing = creators.find((c) => c.id === body.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { id: _id, ...rest } = body;
    void _id;
    const updated = { ...existing, ...rest, id: existing.id };
    await repos.creators.upsertByUsername(updated);
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await repos.creators.delete(id);
  return NextResponse.json({ success: true });
}
