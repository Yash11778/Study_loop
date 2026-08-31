/**
 * Every model id in the codebase lives here. Hosted model names get retired on
 * a few months' notice, so when a call starts 404-ing this is the only file to
 * edit. Verify against the providers' current model lists before deploying.
 */
export const MODELS = {
  groq: {
    // Verified against this account with `npm run doctor`. Groq's catalogue
    // moves; when a call starts 404-ing, run the doctor before touching code.
    fast: "openai/gpt-oss-120b",
  },
  gemini: {
    // Overridable via GEMINI_MODEL -- Google retires these per-project, so a
    // deprecation should be an env change rather than a rebuild.
    reasoning: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    embedding: "gemini-embedding-001",
  },
} as const;

/**
 * gemini-embedding-001 returns 3072 floats by default and supports truncation
 * to a shorter length via outputDimensionality. 768 is plenty for a corpus this
 * size and keeps the documents small.
 *
 * The Atlas vector index is created with this exact number and cannot be
 * changed without dropping the index and re-embedding every chunk.
 */
export const EMBEDDING_DIM = 768;

/** Per-task budgets. Exceeding one triggers the fallback provider. */
export const TASK_BUDGET_MS = {
  "qna.answer": 20_000,
  "quiz.generate": 90_000,
  "result.feedback": 45_000,
  // Authoring is per-section now, but a throttled provider can still queue a
  // small request for a long time before answering.
  "notes.author": 90_000,
  "concepts.extract": 45_000,
} as const;

export type TaskName = keyof typeof TASK_BUDGET_MS;

/**
 * Provider order per task -- deliberately not one global chain. Groq is the
 * latency win, so it leads anything a student waits on. Gemini leads the calls
 * that read the whole note plus a full transcript, where synthesis matters more
 * than first-token time.
 */
/**
 * Provider order per task.
 *
 * Groq leads everything. The earlier arrangement put Gemini first on the
 * long-context tasks, which reads well in the abstract but is wrong against the
 * actual free-tier limits: gemini-2.5-flash allows only 20 requests per DAY,
 * so leading with it spends the entire daily allowance on calls that fail and
 * fall through anyway. Groq meters tokens per minute instead, which recovers in
 * seconds rather than at midnight.
 *
 * Gemini is therefore what a fallback should be -- held in reserve for when the
 * primary is throttled, not the everyday path. Requests are kept small enough
 * for Groq's per-minute budget: sections are authored one at a time, and quiz
 * generation is sent only the passages its blueprint tests.
 *
 * If you move to a paid Gemini tier, putting it first on quiz.generate and
 * result.feedback is the better arrangement -- it handles long context better.
 */
export const CHAIN: Record<TaskName, ReadonlyArray<"groq" | "gemini">> = {
  "qna.answer": ["groq", "gemini"],
  "quiz.generate": ["groq", "gemini"],
  "result.feedback": ["groq", "gemini"],
  "notes.author": ["groq", "gemini"],
  "concepts.extract": ["groq", "gemini"],
};
