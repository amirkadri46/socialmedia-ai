import { publishHistoryRepository } from "@/lib/db/repositories";
import { storageObjectRepository } from "@/lib/db/repositories";
import { getStorageProvider } from "@/lib/storage";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;

  let rows: any[] = [];
  let total = 0;

  try {
    const result = await publishHistoryRepository.findWithFilters({
      account_id: p.get("account_id") ?? undefined,
      video_id: p.get("video_id") ?? undefined,
      from: p.get("from") ?? undefined,
      to: p.get("to") ?? undefined,
      limit: p.get("limit") ? Number(p.get("limit")) : 50,
      offset: p.get("offset") ? Number(p.get("offset")) : 0,
    });
    rows = result.rows;
    total = result.total;
  } catch {
    return Response.json({ entries: [], total: 0 });
  }

  // Batch-resolve thumbnail storage object keys to avoid N+1
  const thumbIds = [...new Set(rows.map((r: any) => r.video_thumbnail_key).filter(Boolean))] as string[];
  const keyMap: Record<string, string> = {};
  if (thumbIds.length > 0) {
    try {
      await Promise.all(
        thumbIds.map(async (id) => {
          const obj = await storageObjectRepository.findById(id);
          if (obj?.key) keyMap[id] = obj.key;
        })
      );
    } catch { /* non-fatal — thumbnails just won't resolve */ }
  }

  let entries: any[] = rows;
  try {
    const storage = getStorageProvider();
    entries = await Promise.all(
      rows.map(async (row: any) => {
        let thumbnail_url: string | null = null;
        const key = row.video_thumbnail_key ? keyMap[row.video_thumbnail_key] : null;
        if (key) thumbnail_url = await storage.getSignedUrl(key, 3600);
        return { ...row, thumbnail_url };
      })
    );
  } catch { /* non-fatal — return rows without signed URLs */ }

  return Response.json({ entries, total });
}
