import OpenAI from "openai";
import { readSettings, type AppSettings } from "./settings";

export interface LlmClient {
  client: OpenAI;
  model: string;
  provider: "openai" | "openrouter";
}

/**
 * Build the OpenAI/OpenRouter client + model from app settings.
 * Shared by the outreach draft route and the lead-analyze route so provider
 * selection logic lives in exactly one place.
 *
 * Throws an Error (with a user-facing message) when configuration is missing.
 */
export function buildLlmClient(settings?: AppSettings): LlmClient {
  const s = settings ?? readSettings();

  if (s.provider !== "openai" && s.provider !== "openrouter") {
    throw new Error(
      `Unknown provider '${s.provider}' — go to Settings to configure OpenAI or OpenRouter.`
    );
  }

  if (s.provider === "openai") {
    const apiKey = s.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not set — go to Settings.");
    return { client: new OpenAI({ apiKey }), model: "gpt-4o", provider: "openai" };
  }

  const apiKey = s.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API key not set — go to Settings.");
  return {
    client: new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" }),
    model: s.openrouterModel || "deepseek/deepseek-v4-flash",
    provider: "openrouter",
  };
}

/**
 * Parse a JSON object out of an LLM response, tolerating markdown fences and
 * stray prose around the JSON. Tries, in order: the raw text, the fence-stripped
 * text, then the first balanced `{…}`/`[…]` substring. Throws if none parse.
 */
export function parseJsonResponse<T>(raw: string): T {
  const candidates: string[] = [];

  const trimmed = raw.trim();
  candidates.push(trimmed);

  // Strip a leading ```json / ``` fence and a trailing ``` fence if present.
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (fenceStripped !== trimmed) candidates.push(fenceStripped);

  // Fall back to the first balanced object/array in the text.
  const objStart = fenceStripped.indexOf("{");
  const objEnd = fenceStripped.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    candidates.push(fenceStripped.slice(objStart, objEnd + 1));
  }
  const arrStart = fenceStripped.indexOf("[");
  const arrEnd = fenceStripped.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    candidates.push(fenceStripped.slice(arrStart, arrEnd + 1));
  }

  let lastErr: unknown;
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Could not parse JSON from model response: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}
