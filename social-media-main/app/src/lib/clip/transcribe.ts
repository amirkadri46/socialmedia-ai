import { readFileSync, existsSync } from "fs";
import path from "path";
import { ffmpeg } from "./ffmpeg";
import { repos } from "../db";
import type { Word } from "../types";

/** Extract a compact mono audio track for transcription. */
async function extractAudio(videoPath: string): Promise<string> {
  const out = path.join(path.dirname(videoPath), "audio.mp3");
  if (!existsSync(out)) {
    await ffmpeg([
      "-y",
      "-i", videoPath,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "64k",
      out,
    ]);
  }
  return out;
}

// ── Deepgram ──────────────────────────────────────────────────────────────────────

async function transcribeDeepgram(audioPath: string, apiKey: string, language: string): Promise<Word[]> {
  const audio = readFileSync(audioPath);
  const params = new URLSearchParams({
    model: "nova-2",
    smart_format: "true",
    punctuate: "true",
    language: language || "en",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/mpeg" },
    body: new Uint8Array(audio),
  });
  if (!res.ok) {
    throw new Error(`Deepgram error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const words = json?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return words.map((w: { word: string; punctuated_word?: string; start: number; end: number }) => ({
    // Prefer Deepgram's punctuated form, but strip trailing commas so captions
    // don't carry automated conversational commas (clean OpusClip-style look).
    text: (w.punctuated_word || w.word).replace(/,+$/, ""),
    start: w.start,
    end: w.end,
  }));
}

// ── AssemblyAI ────────────────────────────────────────────────────────────────────

async function transcribeAssemblyAI(audioPath: string, apiKey: string): Promise<Word[]> {
  const audio = readFileSync(audioPath);
  // 1. upload
  const up = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/octet-stream" },
    body: new Uint8Array(audio),
  });
  if (!up.ok) throw new Error(`AssemblyAI upload error ${up.status}`);
  const { upload_url } = await up.json();

  // 2. request transcript
  const req = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: upload_url, punctuate: true, format_text: true }),
  });
  if (!req.ok) throw new Error(`AssemblyAI transcript error ${req.status}`);
  const { id } = await req.json();

  // 3. poll
  for (let i = 0; i < 600; i++) {
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: apiKey },
    });
    if (!poll.ok) throw new Error(`AssemblyAI poll error ${poll.status}`);
    const data = await poll.json();
    if (data.status === "completed") {
      return (data.words ?? []).map((w: { text: string; start: number; end: number }) => ({
        // Strip trailing commas for the same clean caption look as Deepgram.
        text: w.text.replace(/,+$/, ""),
        start: w.start / 1000,
        end: w.end / 1000,
      }));
    }
    if (data.status === "error") throw new Error(`AssemblyAI: ${data.error}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("AssemblyAI transcription timed out.");
}

// ── Public API ────────────────────────────────────────────────────────────────────

export async function transcribe(videoPath: string, languageCode = "en"): Promise<Word[]> {
  const settings = await repos.settings.get();
  const audioPath = await extractAudio(videoPath);

  switch (settings.transcriptionProvider) {
    case "assemblyai": {
      const key = settings.assemblyaiApiKey || process.env.ASSEMBLYAI_API_KEY;
      if (!key) throw new Error("AssemblyAI API key not set — configure it in Settings.");
      return transcribeAssemblyAI(audioPath, key);
    }
    case "local":
      throw new Error(
        "Local whisper transcription is not wired up in v1. Choose Deepgram or AssemblyAI in Settings."
      );
    case "deepgram":
    default: {
      const key = settings.deepgramApiKey || process.env.DEEPGRAM_API_KEY;
      if (!key) throw new Error("Deepgram API key not set — configure it in Settings.");
      return transcribeDeepgram(audioPath, key, languageCode);
    }
  }
}

/** Render words within [start,end] to a plain transcript string. */
export function wordsToText(words: Word[], start: number, end: number): string {
  return words
    .filter((w) => w.start >= start && w.end <= end)
    .map((w) => w.text)
    .join(" ")
    .trim();
}
