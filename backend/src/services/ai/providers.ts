import Groq from "groq-sdk";
import { env } from "@/config/env";
import { EMBEDDING_DIM, MODELS } from "@/config/ai";

export type ProviderName = "groq" | "gemini";

export type CompletionRequest = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for strict JSON rather than hoping the prose parses. */
  json?: boolean;
  signal?: AbortSignal;
};

export type CompletionResult = {
  text: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
};

/** Classified so the gateway can decide between "retry here" and "escalate". */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly reason: "rate_limit" | "request_too_large" | "server_error" | "timeout" | "unknown",
    readonly status?: number,
    /** How long the provider asked us to wait, when it says. */
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/**
 * Both providers say how long to wait, in different places: Groq in a
 * retry-after header, Gemini in a RetryInfo entry in the error body. Guessing a
 * backoff when the service has already told you the answer just means retrying
 * too early and burning another request.
 */
function retryAfterFrom(headers: unknown, body: string): number | undefined {
  const header = (headers as { get?: (k: string) => string | null })?.get?.("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }

  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (match?.[1]) return Number(match[1]) * 1000;

  return undefined;
}

function classify(status: number): ProviderError["reason"] {
  if (status === 429) return "rate_limit";
  // Groq answers 413 when a single request's prompt plus max_tokens exceeds the
  // tier's per-minute token budget. Recording it as a server error hid the real
  // cause behind an identical-looking failure, so it gets its own reason.
  if (status === 413) return "request_too_large";
  if (status >= 500) return "server_error";
  return "unknown";
}

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

async function callGroq(req: CompletionRequest): Promise<CompletionResult> {
  const model = MODELS.groq.fast;
  try {
    const res = await groq.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 4096,
        ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
      },
      { signal: req.signal }
    );

    return {
      text: res.choices[0]?.message?.content ?? "",
      model,
      tokensIn: res.usage?.prompt_tokens,
      tokensOut: res.usage?.completion_tokens,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (typeof status === "number") {
      // Keep the provider's own explanation. Recording only the status made a
      // token-budget rejection and a daily-quota exhaustion look identical.
      const detail =
        (err as { error?: { error?: { message?: string } } })?.error?.error?.message ??
        (err as { message?: string })?.message ??
        "";
      throw new ProviderError(
        `groq ${status}: ${detail}`.trim(),
        classify(status),
        status,
        retryAfterFrom((err as { headers?: unknown })?.headers, detail)
      );
    }
    throw err;
  }
}

/**
 * Gemini over plain REST rather than an SDK. The surface used here is two
 * endpoints, and it keeps the provider that exists to be the *fallback* from
 * being able to break the build when its SDK has a breaking release.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

async function callGemini(req: CompletionRequest): Promise<CompletionResult> {
  const model = MODELS.gemini.reasoning;
  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    signal: req.signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.3,
        maxOutputTokens: req.maxTokens ?? 4096,
        // 2.5-flash spends thinking tokens out of the SAME budget as the reply,
        // so a long structured answer gets silently truncated mid-JSON. None of
        // these tasks need the reasoning trace, so the budget goes to output.
        thinkingConfig: { thinkingBudget: 0 },
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ProviderError(
      `gemini ${res.status}: ${text}`,
      classify(res.status),
      res.status,
      retryAfterFrom(res.headers, text)
    );
  }

  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const candidate = body.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  // A response can be 200 and still carry nothing: hitting the output cap or a
  // safety stop truncates it. Surfacing that as an empty body would fail later
  // as an opaque JSON parse error instead of here, where the cause is legible.
  if (!text) {
    throw new ProviderError(
      `gemini returned no content (finishReason=${candidate?.finishReason ?? "unknown"})`,
      candidate?.finishReason === "MAX_TOKENS" ? "request_too_large" : "server_error"
    );
  }

  return {
    text,
    model,
    tokensIn: body.usageMetadata?.promptTokenCount,
    tokensOut: body.usageMetadata?.candidatesTokenCount,
  };
}

export const PROVIDERS: Record<ProviderName, (req: CompletionRequest) => Promise<CompletionResult>> = {
  groq: callGroq,
  gemini: callGemini,
};

/** Batch embeddings. Gemini only -- Groq serves no embedding endpoint at all. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = MODELS.gemini.embedding;
  const res = await fetch(`${GEMINI_BASE}/models/${model}:batchEmbedContents`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        // Without this the model returns its full 3072 floats, which would not
        // match the dimension the Atlas index was built with.
        outputDimensionality: EMBEDDING_DIM,
      })),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new ProviderError(
      `gemini embed ${res.status}: ${text}`,
      classify(res.status),
      res.status,
      retryAfterFrom(res.headers, text)
    );
  }

  const body = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
  const out = body.embeddings?.map((e) => e.values ?? []) ?? [];

  if (out.length !== texts.length) {
    throw new Error(`embedding count mismatch: asked for ${texts.length}, got ${out.length}`);
  }
  return out;
}
