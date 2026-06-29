import OpenAI from "openai";
import { readSettings } from "../settings";

/** Resolve the configured chat client + model, mirroring lib/claude.ts. */
export function getChatClient(): { client: OpenAI; model: string } {
  const settings = readSettings();
  if (settings.provider === "openai") {
    const apiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not set — go to Settings to configure it.");
    return { client: new OpenAI({ apiKey }), model: settings.openaiModel || "gpt-4o" };
  }
  const apiKey = settings.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key not set — go to Settings to configure it.");
  return {
    client: new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" }),
    model: settings.openrouterModel || "deepseek/deepseek-v4-flash",
  };
}

export async function chat(prompt: string, maxTokens = 4096): Promise<string> {
  const { client, model } = getChatClient();
  const res = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content ?? "";
}

/** Extract the first JSON array/object from a possibly fenced LLM response. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const firstBracket = body.search(/[[{]/);
  if (firstBracket < 0) {
    throw new Error(`No JSON found in LLM response. Model returned: ${text.trim().slice(0, 200) || "(empty)"}`);
  }
  const lastBracket = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
  const slice = body.slice(firstBracket, lastBracket + 1);
  return JSON.parse(slice);
}
