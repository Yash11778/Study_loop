import type { z } from "zod";
import { connectDB } from "@/db/connection";
import { logger } from "@/utils/logger";
import { AppError } from "@/utils/errors";
import { LlmCall } from "@/models/LlmCall";
import { CHAIN, TASK_BUDGET_MS, type TaskName } from "@/config/ai";
import { PROVIDERS, ProviderError, type CompletionRequest, type ProviderName } from "./providers";

type GenerateArgs<T> = {
  task: TaskName;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
};

export type GenerateResult<T> = {
  data: T;
  provider: ProviderName;
  model: string;
  fellBack: boolean;
};

/** Models like to wrap JSON in prose or fences even when told not to. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return candidate;
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  return end > start ? candidate.slice(start, end + 1) : candidate.slice(start);
}

async function log(row: Record<string, unknown>) {
  try {
    await connectDB();
    await LlmCall.create(row);
  } catch {
    // Telemetry must never take down the request it is describing.
  }
}

/**
 * The single entry point for every LLM call in the app. No route handler talks
 * to a provider SDK directly.
 *
 * Order of escalation, cheapest first:
 *   1. call the leading provider for this task
 *   2. if the JSON fails the schema, feed the error back as a repair turn on
 *      the *same* provider -- a nudged reprompt fixes most shape errors
 *   3. only if that also fails do we spend the fallback provider
 *
 * Rate limits and 5xx skip straight to step 3; there is nothing to repair.
 */
export async function generate<T>({
  task,
  system,
  user,
  schema,
  temperature,
  maxTokens,
  userId,
}: GenerateArgs<T>): Promise<GenerateResult<T>> {
  const chain = CHAIN[task];
  const budget = TASK_BUDGET_MS[task];
  let lastError: unknown;

  for (const [index, provider] of chain.entries()) {
    const fellBack = index > 0;

    /**
     * Two repair attempts on the leading provider, one on the fallback.
     *
     * A single retry was too thin: JSON-mode generations fail often enough that
     * one bad reply escalated to the fallback, and when that provider is out of
     * quota the whole request 503s over something a second attempt would have
     * fixed.
     */
    const attempts = fellBack ? 2 : 3;
    let repairHint = "";

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), budget);
      const startedAt = Date.now();

      const req: CompletionRequest = {
        system,
        user: repairHint ? `${user}\n\n${repairHint}` : user,
        temperature,
        maxTokens,
        json: true,
        signal: controller.signal,
      };

      try {
        const res = await PROVIDERS[provider](req);
        clearTimeout(timer);

        // A truncated or fenced reply throws here. That is a malformed answer,
        // not a transport failure, so it must go down the repair path -- letting
        // it fall to the outer catch would abandon this provider without ever
        // asking it to try again.
        let raw: unknown;
        try {
          raw = JSON.parse(extractJson(res.text));
        } catch (parseError) {
          const detail = parseError instanceof Error ? parseError.message : String(parseError);

          await log({
            task, provider, model: res.model, userId,
            tokensIn: res.tokensIn, tokensOut: res.tokensOut,
            latencyMs: Date.now() - startedAt,
            ok: false, fellBack, reason: "schema_invalid",
            errorMessage: `unparseable JSON: ${detail}`.slice(0, 500),
          });

          lastError = new Error(`unparseable JSON: ${detail}`);
          repairHint =
            "Your previous reply was not valid JSON -- it looks truncated or wrapped in prose. " +
            "Reply with the complete JSON object only, and keep it short enough to finish.";
          continue;
        }

        const parsed = schema.safeParse(raw);

        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");

          await log({
            task, provider, model: res.model, userId,
            tokensIn: res.tokensIn, tokensOut: res.tokensOut,
            latencyMs: Date.now() - startedAt,
            ok: false, fellBack, reason: "schema_invalid",
            errorMessage: issues.slice(0, 500),
          });

          lastError = new Error(`schema_invalid: ${issues}`);
          repairHint =
            `Your previous reply did not satisfy the required JSON shape. ` +
            `Fix exactly these problems and reply with the corrected JSON only: ${issues}`;
          continue;
        }

        await log({
          task, provider, model: res.model, userId,
          tokensIn: res.tokensIn, tokensOut: res.tokensOut,
          latencyMs: Date.now() - startedAt,
          ok: true, fellBack, reason: "none",
        });

        return { data: parsed.data, provider, model: res.model, fellBack };
      } catch (err) {
        clearTimeout(timer);
        lastError = err;

        // Ask the controller, not the error: provider SDKs wrap the abort in
        // their own error type, so err.name is "Error" and the timeout was
        // being recorded as a server fault.
        const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
        const reason = aborted
          ? "timeout"
          : err instanceof ProviderError
            ? err.reason === "unknown"
              ? "server_error"
              : err.reason
            : "server_error";

        await log({
          task, provider, model: "unknown", userId,
          latencyMs: Date.now() - startedAt,
          ok: false, fellBack, reason,
          errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        });

        logger.warn(
          { task, provider, reason, err: err instanceof Error ? err.message : err },
          "provider call failed"
        );

        /**
         * A bad generation is worth asking the same provider to redo; a
         * transport failure is not, and escalating is the only useful move.
         */
        if (err instanceof ProviderError && err.reason === "invalid_generation") {
          lastError = err;
          repairHint =
            "Your previous reply was not valid JSON. Reply with a single, complete " +
            "JSON object and nothing else -- no prose before or after it, no code fences.";
          continue;
        }

        break;
      }
    }
  }

  logger.error(
    { task, chain, err: lastError instanceof Error ? lastError.message : lastError },
    "all providers failed"
  );

  // Both providers being unavailable is a real outage, but it is transient and
  // retrying usually works -- so it is a 503 with something the student can act
  // on, not a 500 that reads as "this app is broken".
  throw new AppError(
    503,
    "inference_unavailable",
    "The question service is busy right now. Give it a minute and try again.",
    {
      task,
      // Carried through so a batch caller can wait exactly as long as the
      // provider asked rather than guessing.
      retryAfterMs: lastError instanceof ProviderError ? lastError.retryAfterMs : undefined,
    }
  );
}
