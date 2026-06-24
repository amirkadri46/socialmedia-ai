import { NextResponse } from "next/server";
import { chat } from "@/lib/clip/llm";
import { getClip, getCaptionPromptTemplate } from "@/lib/clip/store";

export const maxDuration = 60;

// Regenerate-copy controls mirror the OpusClip schedule modal (Tone/Format/Mimic/Hashtag).
// `templateId` selects a reusable per-creator caption-context template (creator bio, niche,
// audience, CTA, hashtags, brand voice) that becomes the fixed base context for the caption —
// only the per-clip variables (title, topic, hook) change from clip to clip.
interface CaptionRequest {
  clipId: string;
  platform?: string;
  tone?: string;
  format?: string;
  mimic?: string;
  hashtags?: boolean;
  instruction?: string;
  templateId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CaptionRequest;
    const clip = getClip(body.clipId);
    if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

    const template = body.templateId ? getCaptionPromptTemplate(body.templateId) : undefined;

    const platform = body.platform || "Instagram";
    const directives: string[] = [];
    if (template?.brandVoice) directives.push(`Match this brand voice exactly: ${template.brandVoice}.`);
    if (body.tone) directives.push(`Tone: ${body.tone}.`);
    if (body.format) directives.push(`Format: ${body.format}.`);
    if (body.mimic) directives.push(`Mimic this creator's voice: ${body.mimic}.`);
    if (template?.cta) directives.push(`Include this call to action: ${template.cta}.`);
    if (body.instruction) directives.push(body.instruction);

    // Hashtag policy: an explicit body.hashtags === false always wins (user toggled them off).
    // Otherwise, a template's curated hashtag set takes precedence over generic ones.
    if (body.hashtags === false) {
      directives.push("Do not include hashtags.");
    } else if (template?.includeHashtags && template.hashtags) {
      directives.push(`End with these hashtags (you may trim to the most relevant): ${template.hashtags}`);
    } else if (template && !template.includeHashtags) {
      directives.push("Do not include hashtags.");
    } else {
      directives.push("End with 8-12 relevant, high-reach hashtags.");
    }

    // The creator context block stays IDENTICAL across every clip from the same template —
    // consistency is the point. Only the per-clip variables below vary.
    const creatorContext = template
      ? `# CREATOR CONTEXT (stays fixed across all clips for ${template.creator || template.name})
${template.context}
Write every caption so it is unmistakably from this creator. Keep the persona, niche, and audience consistent; never contradict the context above.
`
      : "";

    const prompt = `# ROLE
You write scroll-stopping ${platform} captions for short-form video clips.

${creatorContext}# CLIP VARIABLES (these change per clip)
Title: ${clip.title}
Topic: ${clip.genre}
Hook: ${clip.hook}
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
