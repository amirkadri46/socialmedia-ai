import { NextResponse } from "next/server";
import { repos } from "@/lib/db";
import { scrapeCreatorStats } from "@/lib/apify";

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json();
  const ids: string[] = body.ids || [];

  const creators = await repos.creators.getAll();
  const toRefresh = ids.length > 0
    ? creators.filter((c) => ids.includes(c.id))
    : creators;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const creator of toRefresh) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "progress", username: creator.username, status: "scraping" })}\n\n`)
          );

          const stats = await scrapeCreatorStats(creator.username);
          const updated = {
            ...creator,
            profilePicUrl: stats.profilePicUrl,
            followers: stats.followers,
            reelsCount30d: stats.reelsCount30d,
            avgViews30d: stats.avgViews30d,
            lastScrapedAt: new Date().toISOString(),
          };
          await repos.creators.upsertByUsername(updated);

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "progress", username: creator.username, status: "done", stats })}\n\n`)
          );
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", username: creator.username, error: err instanceof Error ? err.message : "Unknown" })}\n\n`)
          );
        }
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "complete" })}\n\n`)
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
