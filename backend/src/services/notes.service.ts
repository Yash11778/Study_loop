import { z } from "zod";
import { generate } from "./ai/gateway";
import { logger } from "@/utils/logger";

/**
 * Note authoring and concept extraction. Both run once at seed time, so they
 * are allowed to be slow and to lead with Gemini for the longer context.
 */

const sectionSchema = z.object({
  bodyMd: z.string().min(600),
});

/**
 * Groq's free tier allows 8000 tokens per minute, and max_tokens is RESERVED
 * against that budget rather than merely counted when used. A section reserves
 * roughly 1,800 (prompt plus ceiling), so about four fit in a minute. Pacing at
 * 15s keeps the loop just inside that instead of racing into a 429 and then
 * waiting out a backoff anyway.
 */
const PACE_MS = 15_000;
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries a section with exponential backoff.
 *
 * Seeding is a batch job that runs for minutes, so a transient rate limit
 * should cost a pause, not the whole run -- the alternative is re-authoring
 * thirteen good sections because the fourteenth was unlucky. User-facing calls
 * deliberately do NOT do this: there, failing fast and falling back matters more
 * than eventually succeeding.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS) break;

      const asked = (err as { details?: { retryAfterMs?: number } })?.details?.retryAfterMs;
      // Honour the provider's own figure when it gave one; otherwise back off.
      const waitMs = asked && asked > 0 ? asked + 1_000 : 5_000 * 2 ** (attempt - 1);
      logger.warn(
        { section: label, attempt, of: MAX_ATTEMPTS, waitMs },
        "section failed, backing off before retrying"
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Removes a title the model repeated at the top of its own section.
 *
 * The prompt tells it not to emit a heading, and it mostly complies -- but it
 * often opens with the title in bold instead, which renders as the same words
 * twice directly under the real heading. Stripping it here is cheaper and more
 * reliable than continuing to negotiate with the prompt.
 */
export function stripEchoedTitle(bodyMd: string, title: string): string {
  const normalise = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = normalise(title);

  const lines = bodyMd.trim().split("\n");
  const first = lines[0]?.trim() ?? "";

  // A heading, a bold line, or the bare title on a line of its own.
  const stripped = first.replace(/^#{1,6}\s*/, "").replace(/^\*\*(.*)\*\*$/, "$1").trim();

  if (stripped && normalise(stripped) === wanted) {
    return lines.slice(1).join("\n").trim();
  }
  return bodyMd.trim();
}

const AUTHOR_STYLE =
  "You write study notes for first-year undergraduate engineering students.\n" +
  "Explain from first principles. Define every symbol the first time it appears, with units. " +
  "State assumptions and say explicitly when an approximation stops being valid. " +
  "Anticipate the specific mistakes students make on this material and address them directly.\n" +
  "Use Markdown: '### ' for sub-headings, blank lines between paragraphs, '- ' for lists. " +
  "Do NOT emit a top-level '## ' heading -- the section heading is added for you.\n" +
  "Write formulae in plain text such as F = G*m1*m2/r^2. Never use LaTeX delimiters.\n" +
  "Because an asterisk means multiplication here, never use single asterisks for " +
  "emphasis. Use **double asterisks** if you must emphasise something.";

/**
 * Authors one section.
 *
 * The whole note used to be a single call, which capped its real depth: asking
 * for more words in one request runs into the output ceiling and comes back
 * truncated mid-sentence, and the larger max_tokens then gets the request
 * rejected outright on a per-minute token budget. Section-at-a-time keeps every
 * call small and lets the note be as long as it needs to be.
 */
async function authorSection(
  subject: string,
  section: { title: string; brief: string },
  precedingTitles: string[]
) {
  const { data, provider, model } = await generate({
    task: "notes.author",
    schema: sectionSchema,
    temperature: 0.4,
    // 300-450 words is ~600 tokens. The ceiling is reserved against a per-minute
    // budget, so an inflated one buys nothing and costs throughput.
    maxTokens: 1200,
    system: AUTHOR_STYLE,
    user:
      `Subject: ${subject}\n\n` +
      `You are writing the section titled "${section.title}".\n\n` +
      `Cover: ${section.brief}\n\n` +
      (precedingTitles.length
        ? `Earlier sections already covered: ${precedingTitles.join("; ")}. ` +
          `Build on them rather than repeating their definitions.\n\n`
        : "") +
      `Write 320-400 words. Reply as JSON: {"bodyMd": string}`,
  });

  return { ...data, provider, model };
}

/**
 * Authors every section in order and assembles them into one note. Sequential
 * rather than parallel: the providers meter tokens per minute, and a burst of
 * simultaneous calls is the reliable way to get throttled.
 */
export async function authorNote(
  subject: string,
  title: string,
  sections: ReadonlyArray<{ title: string; brief: string }>,
  onProgress?: (done: number, total: number, title: string) => void
) {
  const written: Array<{ title: string; brief: string; bodyMd: string }> = [];
  const titles: string[] = [];
  let provider = "";
  let model = "";

  for (const [index, section] of sections.entries()) {
    // Pace the loop. Fourteen sections back to back is itself a burst, and the
    // providers meter tokens per minute -- so the seed throttles itself instead
    // of racing into a 429 it then has to recover from.
    if (index > 0) await sleep(PACE_MS);

    const result = await withRetry(() => authorSection(subject, section, titles), section.title);

    written.push({
      title: section.title,
      brief: section.brief,
      bodyMd: stripEchoedTitle(result.bodyMd, section.title),
    });
    titles.push(section.title);
    provider = result.provider;
    model = result.model;

    onProgress?.(written.length, sections.length, section.title);
  }

  // Sections are returned as well as assembled: the concept map is derived from
  // this structure rather than re-extracted from the finished prose.
  return {
    title,
    sections: written,
    bodyMd: written.map((s) => `## ${s.title}\n\n${s.bodyMd}`).join("\n\n"),
    provider,
    model,
  };
}

const conceptsSchema = z.object({
  concepts: z
    .array(
      z.object({
        slug: z
          .string()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"),
        label: z.string().min(3).max(60),
        summary: z.string().min(20).max(300),
      })
    )
    .min(8)
    .max(16),
});

/**
 * These slugs become permanent identifiers: signal scoring, quiz blueprints and
 * result breakdowns all key off them. Extracted once, never regenerated for an
 * existing note.
 */
export async function extractConcepts(bodyMd: string) {
  const { data } = await generate({
    task: "concepts.extract",
    schema: conceptsSchema,
    temperature: 0.1,
    system:
      "You break study notes into the distinct concepts a student could understand or " +
      "misunderstand independently. A concept is testable on its own. Prefer the " +
      "distinctions students actually confuse (field versus force, mass versus weight) " +
      "over chapter headings.",
    user:
      `Notes:\n"""\n${bodyMd}\n"""\n\n` +
      `Identify 8-16 concepts. Reply as JSON: ` +
      `{"concepts":[{"slug":"kebab-case","label":"Short name","summary":"One or two sentences"}]}`,
  });

  return data.concepts;
}

/**
 * Maps each concept to the chunks that teach it, by asking which chunk indices
 * cover it. Done with one call over numbered chunks rather than per-concept,
 * which would be a dozen round trips for no extra accuracy.
 */
const mappingSchema = z.object({
  mapping: z.array(z.object({ slug: z.string(), chunkOrdinals: z.array(z.number().int().nonnegative()) })),
});

export async function mapConceptsToChunks(
  concepts: Array<{ slug: string; label: string }>,
  chunks: Array<{ ordinal: number; content: string }>
) {
  const numbered = chunks.map((c) => `[${c.ordinal}] ${c.content}`).join("\n\n---\n\n");

  const { data } = await generate({
    task: "concepts.extract",
    schema: mappingSchema,
    temperature: 0,
    maxTokens: 2000,
    system: "You match concepts to the numbered passages that teach them. A passage may serve several concepts.",
    user:
      `Concepts:\n${concepts.map((c) => `- ${c.slug}: ${c.label}`).join("\n")}\n\n` +
      `Passages:\n${numbered}\n\n` +
      `For every concept list the passage numbers that teach it. Reply as JSON: ` +
      `{"mapping":[{"slug":"...","chunkOrdinals":[0,2]}]}`,
  });

  const bySlug = new Map(data.mapping.map((m) => [m.slug, m.chunkOrdinals]));
  const maxOrdinal = chunks.length - 1;

  // The model can hallucinate an out-of-range index; clamp rather than trust.
  return concepts.map((c) => ({
    ...c,
    chunkOrdinals: (bySlug.get(c.slug) ?? []).filter((n) => n >= 0 && n <= maxOrdinal),
  }));
}
