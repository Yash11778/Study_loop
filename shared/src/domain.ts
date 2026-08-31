/**
 * Vocabulary shared by both sides of the wire: values that show up in URLs,
 * database enums and UI copy, defined once so they cannot drift apart.
 */
export const DIFFICULTIES = ["recall", "apply", "analyse"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const RESULT_BANDS = ["needs_work", "developing", "solid", "strong"] as const;
export type ResultBand = (typeof RESULT_BANDS)[number];

export const SIGNAL_REASONS = ["first_question", "follow_up", "explicit_confusion", "baseline"] as const;
export type SignalReason = (typeof SIGNAL_REASONS)[number];

/**
 * How much each kind of Q&A turn moves a concept's struggle score. A follow-up
 * outweighs a first question because a repeat means the first answer missed;
 * explicit_confusion is applied as a multiplier on top rather than as a base.
 */
export const SIGNAL_WEIGHTS = {
  first_question: 1.0,
  follow_up: 1.6,
  explicit_confusion: 1.4,
  /** Floor for concepts nobody asked about, so a silent session still quizzes. */
  baseline: 0.4,
} as const satisfies Record<SignalReason, number>;

export const QUIZ_LENGTH = 10;

export function bandFor(score: number): ResultBand {
  if (score < 40) return "needs_work";
  if (score < 65) return "developing";
  if (score < 85) return "solid";
  return "strong";
}

export const BAND_LABEL: Record<ResultBand, string> = {
  needs_work: "Needs work",
  developing: "Developing",
  solid: "Solid",
  strong: "Strong",
};
