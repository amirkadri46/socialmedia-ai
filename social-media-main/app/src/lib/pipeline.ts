import { v4 as uuid } from "uuid";
import { readConfigs, readCreators, readVideos, writeVideos } from "./csv";
import { scrapeReels } from "./apify";
import { uploadVideo, analyzeVideo } from "./gemini";
import { generateNewConcepts } from "./claude";
import type { PipelineParams, PipelineProgress, Video, ActiveTask } from "./types";

const VIDEO_CONCURRENCY = 1;

interface ScrapedVideo {
  videoUrl: string;
  postUrl: string;
  views: number;
  likes: number;
  comments: number;
  username: string;
  thumbnail: string;
  datePosted: string;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export async function runPipeline(
  params: PipelineParams,
  onProgress: (progress: PipelineProgress) => void
): Promise<void> {
  const progress: PipelineProgress = {
    status: "running",
    phase: "scraping",
    activeTasks: [],
    creatorsCompleted: 0,
    creatorsTotal: 0,
    creatorsScraped: 0,
    videosAnalyzed: 0,
    videosTotal: 0,
    errors: [],
    log: [],
  };

  const emit = () => {
    onProgress({ ...progress, activeTasks: [...progress.activeTasks], log: [...progress.log], errors: [...progress.errors] });
  };

  const log = (msg: string) => {
    progress.log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    emit();
  };

  const addTask = (task: ActiveTask) => {
    progress.activeTasks.push(task);
    emit();
  };

  const updateTask = (id: string, step: string) => {
    const t = progress.activeTasks.find((t) => t.id === id);
    if (t) { t.step = step; emit(); }
  };

  const removeTask = (id: string) => {
    progress.activeTasks = progress.activeTasks.filter((t) => t.id !== id);
    emit();
  };

  try {
    // Load config
    const configs = readConfigs();
    const config = configs.find((c) => c.configName === params.configName);
    if (!config) throw new Error(`Config "${params.configName}" not found`);

    log(`Loaded config: ${config.configName}`);

    // Load creators
    const allCreators = readCreators();
    const creators = allCreators.filter((c) => c.category === config.creatorsCategory);
    if (creators.length === 0) throw new Error(`No creators found for category "${config.creatorsCategory}"`);

    // Deduplicate creators by username to avoid duplicate task IDs
    const seen = new Set<string>();
    const uniqueCreators = creators.filter((c) => {
      if (seen.has(c.username)) return false;
      seen.add(c.username);
      return true;
    });

    progress.creatorsTotal = uniqueCreators.length;
    log(`Found ${uniqueCreators.length} creators — scraping 2 at a time`);
    emit();

    // Phase 1: Scrape creators 2 at a time to stay within Apify's 8192MB memory limit
    // (each run uses ~1024MB, so 2 concurrent = 2048MB max)
    progress.phase = "scraping";
    const cutoffDate = new Date(Date.now() - params.nDays * 24 * 60 * 60 * 1000);
    const allTopVideos: ScrapedVideo[] = [];

    await runWithConcurrency(uniqueCreators, 2, async (creator) => {
      const taskId = `scrape-${creator.id}`;
      addTask({ id: taskId, creator: creator.username, step: "Scraping reels" });
      try {
        const reels = await scrapeReels(creator.username, params.maxVideos, params.nDays);
        updateTask(taskId, `Found ${reels.length} reels`);

        const videos = reels
          .filter((r) => r.videoUrl && r.timestamp)
          .map((r) => ({
            videoUrl: r.videoUrl,
            postUrl: r.url,
            views: r.videoPlayCount || 0,
            likes: r.likesCount || 0,
            comments: r.commentsCount || 0,
            username: r.ownerUsername || creator.username,
            thumbnail: r.images?.[0] || "",
            datePosted: r.timestamp?.split("T")[0] || "",
            timestamp: new Date(r.timestamp),
          }))
          .filter((v) => v.timestamp >= cutoffDate);

        videos.sort((a, b) => b.views - a.views);
        const topVideos = videos.slice(0, params.topK);

        log(`@${creator.username}: ${reels.length} reels → top ${topVideos.length} selected`);
        for (const v of topVideos) allTopVideos.push(v);
        progress.creatorsCompleted++;
        progress.creatorsScraped++;
      } catch (err) {
        const msg = `Scraping error: ${err instanceof Error ? err.message : err}`;
        progress.errors.push(msg);
        log(msg);
        progress.creatorsCompleted++;
      } finally {
        removeTask(taskId);
        emit();
      }
    });

    progress.videosTotal = allTopVideos.length;
    log(`Scraping done. ${allTopVideos.length} videos to analyze (${VIDEO_CONCURRENCY} workers)`);
    emit();

    // Phase 2: Process videos concurrently
    progress.phase = "analyzing";
    emit();

    const newVideos: Video[] = [];

    await runWithConcurrency(allTopVideos, VIDEO_CONCURRENCY, async (video) => {
      const taskId = `video-${uuid().slice(0, 8)}`;
      const label = `${video.views.toLocaleString()} views`;

      try {
        addTask({ id: taskId, creator: video.username, step: "Downloading", views: video.views });

        const videoResponse = await fetch(video.videoUrl);
        if (!videoResponse.ok) throw new Error(`Download failed: ${videoResponse.status}`);
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        const contentType = videoResponse.headers.get("content-type") || "video/mp4";

        updateTask(taskId, "Uploading to Gemini");
        log(`@${video.username} (${label}): uploading to Gemini`);

        const fileData = await uploadVideo(videoBuffer, contentType);

        updateTask(taskId, "Gemini analyzing");
        log(`@${video.username} (${label}): Gemini analyzing`);

        const analysis = await analyzeVideo(
          fileData.uri,
          fileData.mimeType,
          config.analysisInstruction
        );

        updateTask(taskId, "Claude generating concepts");
        log(`@${video.username} (${label}): Claude generating concepts`);

        const newConcepts = await generateNewConcepts(analysis, config.newConceptsInstruction);

        const videoRecord: Video = {
          id: uuid(),
          link: video.postUrl,
          thumbnail: video.thumbnail,
          creator: video.username,
          views: video.views,
          likes: video.likes,
          comments: video.comments,
          analysis,
          newConcepts,
          datePosted: video.datePosted,
          dateAdded: new Date().toISOString().slice(0, 10),
          configName: params.configName,
          starred: false,
        };

        newVideos.push(videoRecord);
        progress.videosAnalyzed++;
        removeTask(taskId);
        log(`@${video.username} (${label}): done`);
        emit();
      } catch (err) {
        removeTask(taskId);
        const msg = `@${video.username} (${label}): ${err instanceof Error ? err.message : err}`;
        progress.errors.push(msg);
        log(`Error — ${msg}`);
        emit();
      }
    });

    // Write all new videos at once
    if (newVideos.length > 0) {
      const existing = readVideos();
      writeVideos([...existing, ...newVideos]);
    }

    progress.phase = "done";
    progress.status = "completed";
    log(`Pipeline complete! ${progress.videosAnalyzed}/${progress.videosTotal} videos analyzed, ${progress.errors.length} errors.`);
    emit();
  } catch (err) {
    progress.status = "error";
    const msg = `Pipeline error: ${err instanceof Error ? err.message : err}`;
    progress.errors.push(msg);
    log(msg);
    emit();
  }
}
