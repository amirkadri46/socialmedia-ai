import { NextResponse } from "next/server";
import { chat } from "@/lib/clip/llm";
import { getClip } from "@/lib/clip/store";

export const maxDuration = 60;

// Regenerate-copy controls mirror the OpusClip schedule modal (Tone/Format/Mimic/Hashtag).
interface CaptionRequest {
  clipId: string;
  platform?: string;
  tone?: string;
  format?: string;
  mimic?: string;
  hashtags?: boolean;
  instruction?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CaptionRequest;
    const clip = getClip(body.clipId);
    if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

    const platform = body.platform || "Instagram";
    const directives: string[] = [];
    if (body.tone) directives.push(`Tone: ${body.tone}.`);
    if (body.format) directives.push(`Format: ${body.format}.`);
    if (body.mimic) directives.push(`Mimic this creator's voice: ${body.mimic}.`);
    if (body.instruction) directives.push(body.instruction);
    directives.push(
      body.hashtags === false
        ? "Do not include hashtags."
        : "End with 8-12 relevant, high-reach hashtags."
    );

    const prompt = `# ROLE
You write scroll-stopping ${platform} captions for short-form video clips.

# CLIP
Title: ${clip.title}
Hook: ${clip.hook}
Genre: ${clip.genre}
Transcript: ${clip.transcript.slice(0, 1500)}

# INSTRUCTIONS
${directives.join("\n")}
Write ONE caption only. Start with a strong hook line. Keep it punchy and native to ${platform}. Return only the caption text.`;

    const caption = (await chat(prompt, 800)).trim();
    return NextResponse.json({ caption });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate caption." },
      { status: 500 }
    );
  }
}
