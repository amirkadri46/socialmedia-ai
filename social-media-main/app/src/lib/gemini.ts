const GEMINI_UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  return key;
}

export async function uploadVideo(
  videoBuffer: Buffer,
  mimeType: string
): Promise<{ uri: string; mimeType: string }> {
  const key = getApiKey();

  const response = await fetch(`${GEMINI_UPLOAD_URL}?key=${key}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "start, upload, finalize",
      "X-Goog-Upload-Header-Content-Length": String(videoBuffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(videoBuffer),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini upload error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const fileName = data.file.name; // e.g. "files/abc123"
  const fileUri = data.file.uri;
  const fileMimeType = data.file.mimeType;

  // Poll until file is ACTIVE (Gemini needs to process the upload)
  await waitForFileActive(fileName);

  return { uri: fileUri, mimeType: fileMimeType };
}

async function waitForFileActive(fileName: string, maxWaitMs = 120000): Promise<void> {
  const key = getApiKey();
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${key}`
    );

    if (!response.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const data = await response.json();
    const state = data.state;

    if (state === "ACTIVE") return;
    if (state === "FAILED") throw new Error(`Gemini file processing failed for ${fileName}`);

    // Still PROCESSING — wait and retry
    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error(`Gemini file ${fileName} did not become ACTIVE within ${maxWaitMs / 1000}s`);
}

export async function analyzeVideo(
  fileUri: string,
  mimeType: string,
  analysisPrompt: string,
  maxRetries = 5
): Promise<string> {
  const key = getApiKey();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(`${GEMINI_GENERATE_URL}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { fileData: { fileUri, mimeType } },
              { text: analysisPrompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();

      if (response.status === 429 && attempt < maxRetries - 1) {
        // Parse the retryDelay from the API response (e.g. "18s"), fall back to 30s
        let retrySeconds = 30;
        try {
          const json = JSON.parse(text);
          const retryInfo = json?.error?.details?.find(
            (d: { "@type": string }) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
          );
          if (retryInfo?.retryDelay) {
            retrySeconds = parseInt(retryInfo.retryDelay) + 5; // add 5s buffer
          }
        } catch { /* use default */ }
        await new Promise((r) => setTimeout(r, retrySeconds * 1000));
        continue;
      }

      throw new Error(`Gemini analysis error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const hashIndex = text.indexOf("#");
    return hashIndex >= 0 ? text.substring(hashIndex) : text;
  }

  throw new Error("Gemini analysis failed after retries");
}
