import OpenAI from "openai";
import { readSettings } from "./settings";

export async function generateNewConcepts(
  videoAnalysis: string,
  newConceptsPrompt: string
): Promise<string> {
  const settings = readSettings();

  let client: OpenAI;
  let model: string;

  if (settings.provider === "openai") {
    const apiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not set — go to Settings to configure it.");
    client = new OpenAI({ apiKey });
    model = "gpt-4o";
  } else {
    const apiKey = settings.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OpenRouter API key not set — go to Settings to configure it.");
    client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
    model = settings.openrouterModel || "deepseek/deepseek-v4-flash";
  }

  const response = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `# ROLE
You're an expert in creating viral Reels on Instagram.

# OBJECTIVE
Take as input viral video from my competitor and based on it generate new concepts for me. Adapt this reference for me.

# REFERENCE VIDEO DESCRIPTION
------
${videoAnalysis}
------

# MY INSTRUCTIONS FOR NEW CONCEPTS
------
${newConceptsPrompt}
------

# BEGIN YOUR WORK`,
      },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}
