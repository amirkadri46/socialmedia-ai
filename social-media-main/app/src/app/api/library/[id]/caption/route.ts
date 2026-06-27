import { videoRepository, videoCaptionRepository } from "@/lib/db/repositories";
import { buildLlmClient } from "@/lib/llm-client";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const captions = await videoCaptionRepository.findByVideo(id);
  return Response.json(captions);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const platform = body.platform ?? "instagram";
  const language = body.language ?? "en";

  const video = await videoRepository.findById(id);
  if (!video) return Response.json({ error: "Not found" }, { status: 404 });

  const prompt = body.promptTemplate
    ?? `Write an engaging Instagram caption for a video titled '${video.title}' by ${video.creator ?? "Unknown"}. Include 5-10 relevant hashtags. Keep it authentic and under 150 words.`;

  const { client, model } = buildLlmClient();
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
  });
  const caption = completion.choices[0]?.message?.content ?? "";

  await videoCaptionRepository.upsert({ video_id: id, platform, language, caption });

  return Response.json({ caption });
}
