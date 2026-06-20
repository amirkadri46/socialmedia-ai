import { scrapeVideoByUrl } from "@/lib/apify";
import { uploadVideo, analyzeVideo } from "@/lib/gemini";
import { generateNewConcepts } from "@/lib/claude";
import { readConfigs, readVideos, writeVideos } from "@/lib/csv";
import { v4 as uuid } from "uuid";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { url, configName, creatorOverride } = await request.json() as {
    url: string;
    configName: string;
    creatorOverride?: string;
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const log: string[] = [];

      const emit = (status: string, step: string, extra: Record<string, unknown> = {}) => {
        const line = `data: ${JSON.stringify({ status, step, log: [...log], ...extra })}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      const addLog = (msg: string) => {
        log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
      };

      try {
        const configs = readConfigs();
        const config = configs.find((c) => c.configName === configName);
        if (!config) throw new Error(`Config "${configName}" not found`);

        addLog(`Config: ${configName}`);
        emit("running", "Scraping video info...");

        const reel = await scrapeVideoByUrl(url);
        if (!reel || !reel.videoUrl) throw new Error("No video found at that URL — make sure it's a public reel.");

        const creator = creatorOverride || reel.ownerUsername || "unknown";
        const views = reel.videoPlayCount ?? 0;
        const label = `@${creator} (${views.toLocaleString()} views)`;

        addLog(`Found: ${label}`);
        emit("running", "Downloading video...");

        const videoRes = await fetch(reel.videoUrl);
        if (!videoRes.ok) throw new Error(`Download failed: ${videoRes.status}`);
        const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
        const contentType = videoRes.headers.get("content-type") || "video/mp4";

        addLog("Uploading to Gemini...");
        emit("running", "Uploading to Gemini...");

        const fileData = await uploadVideo(videoBuffer, contentType);

        addLog("Gemini analyzing...");
        emit("running", "Analyzing with Gemini...");

        const analysis = await analyzeVideo(fileData.uri, fileData.mimeType, config.analysisInstruction);

        addLog("Generating concepts...");
        emit("running", "Generating concepts...");

        const newConcepts = await generateNewConcepts(analysis, config.newConceptsInstruction);

        const video = {
          id: uuid(),
          link: reel.url || url,
          thumbnail: reel.images?.[0] || reel.displayUrl || "",
          creator,
          views,
          likes: reel.likesCount ?? 0,
          comments: reel.commentsCount ?? 0,
          analysis,
          newConcepts,
          datePosted: reel.timestamp?.split("T")[0] || "",
          dateAdded: new Date().toISOString().slice(0, 10),
          configName,
          starred: false,
        };

        const existing = readVideos();
        writeVideos([...existing, video]);

        addLog(`Done — saved under @${creator}`);
        emit("completed", "Done", { video });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`Error: ${msg}`);
        emit("error", "Failed", { error: msg });
      } finally {
        controller.close();
      }
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
