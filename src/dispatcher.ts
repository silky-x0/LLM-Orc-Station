/**
 * Makes the actual call to the model provider (or mock).
 *
 * Why separate from router?
 *   Router decides WHICH model+key to use.
 *   Dispatcher is responsible for HOW to call it.
 *   Separation of concerns: if you add a new provider (OpenAI, Cohere)
 *   you only touch dispatcher.ts, not the routing logic.
 *
 * Real Gemini call:
 *   Uses the generativelanguage.googleapis.com REST API.
 *   No SDK needed — plain fetch() keeps dependencies minimal.
 *   If GEMINI_API_KEY is not set, falls back to mock response automatically.
 *
 * Error handling:
 *   - Network errors → throw (caller logs failure, trips circuit breaker)
 *   - 429 (rate limit) → throw with specific message (helps debug key rotation)
 *   - 4xx other → throw
 *   - 5xx → throw (transient, circuit breaker will back off)
 */

import type { Model, ApiKey } from "./types.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface DispatchResult {
  text: string;
  latencyMs: number;
}

export async function callModel(
  model: Model,
  key: ApiKey,
  prompt: string,
): Promise<DispatchResult> {
  const start = Date.now();

  // ── Mock model (always synthetic) ─────────────────────────────────────────
  if (model.isMock) {
    // Simulate realistic variable latency so mock data looks real in charts
    const jitter = Math.random() * 20;
    await sleep(model.avgLatency + jitter);
    return {
      text: mockResponse(prompt),
      latencyMs: Date.now() - start,
    };
  }

  // ── Real Gemini call ────────────────────────────────────────────────────────
  // If no real key is configured (value starts with "key-"), fall back to mock
  if (key.value.startsWith("key-")) {
    console.log(
      `[Dispatcher] No real API key for ${model.name}, using mock response`,
    );
    await sleep(model.avgLatency + Math.random() * 100);
    return {
      text: mockResponse(prompt),
      latencyMs: Date.now() - start,
    };
  }

  const url = `${GEMINI_BASE}/${model.apiModel}:generateContent?key=${key.value}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 512,
      temperature: 0.7,
    },
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000), // 30s hard timeout
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error calling ${model.name}: ${msg}`);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "(unreadable)");
    if (response.status === 429) {
      throw new Error(
        `Rate limited on key ${key.id.slice(0, 8)} for ${model.name}: ${errBody}`,
      );
    }
    throw new Error(`HTTP ${response.status} from ${model.name}: ${errBody}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "(empty response)";

  return {
    text,
    latencyMs: Date.now() - start,
  };
}

// ─── Mock response generator ──────────────────────────────────────────────────
// Produces varied responses to make simulator logs more realistic
const MOCK_ANSWERS = [
  "The answer is {n}.",
  "Great question! In simple terms, this involves applying basic principles.",
  "Let me explain: the process works by breaking the problem into smaller parts.",
  "The solution requires understanding the core concept first.",
  "Based on the information provided, the most likely answer is correct.",
];

function mockResponse(prompt: string): string {
  const idx = Math.abs(hashStr(prompt)) % MOCK_ANSWERS.length;
  return (MOCK_ANSWERS[idx] ?? MOCK_ANSWERS[0]!).replace(
    "{n}",
    String(Math.floor(Math.random() * 100)),
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ─── Type for Gemini REST response ───────────────────────────────────────────
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
