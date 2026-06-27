const GRAPH_BASE = "https://graph.instagram.com/v21.0";

export interface PublishResult {
  mediaId: string;
}

export async function createReelContainer(params: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
}): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/${params.igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: params.videoUrl,
      caption: params.caption,
      share_to_feed: true,
      access_token: params.accessToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Instagram container creation failed: ${JSON.stringify(data)}`);
  }
  return data.id as string;
}

export async function waitForContainer(params: {
  accessToken: string;
  containerId: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = params.timeoutMs ?? 10 * 60 * 1000;
  const pollIntervalMs = 10_000;
  const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollIntervalMs);
    const res = await fetch(
      `${GRAPH_BASE}/${params.containerId}?fields=status_code,status&access_token=${params.accessToken}`
    );
    const data = await res.json();

    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(`Instagram container ${params.containerId} error: ${JSON.stringify(data)}`);
    }
  }

  throw new Error(`Container ${params.containerId} timed out after ${timeoutMs / 1000}s`);
}

export async function publishContainer(params: {
  igUserId: string;
  accessToken: string;
  containerId: string;
}): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/${params.igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: params.containerId,
      access_token: params.accessToken,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(`Instagram publish failed: ${JSON.stringify(data)}`);
  }
  return data.id as string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
