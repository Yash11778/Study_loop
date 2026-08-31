import type { Types } from "mongoose";
import { QUIZ_LENGTH, SIGNAL_WEIGHTS, type Difficulty } from "@study-loop/shared";
import { QnaTurn } from "@/models/QnaTurn";

export type BlueprintEntry = {
  conceptSlug: string;
  struggleScore: number;
  questionCount: number;
  difficulty: Difficulty;
};

/**
 * Turns a session's Q&A history into a quiz plan.
 *
 * Every concept in the note starts at the baseline floor, so a student who
 * asked nothing still gets a coherent general quiz rather than an empty
 * blueprint the generator would have to free-associate around. Concepts they
 * actually asked about rise above that floor and take more of the ten slots.
 */
export async function buildBlueprint(
  sessionId: Types.ObjectId,
  conceptSlugs: string[],
  comfortLevel: number | undefined
): Promise<BlueprintEntry[]> {
  const grouped = await QnaTurn.aggregate<{ _id: string; total: number }>([
    { $match: { sessionId } },
    { $unwind: "$signals" },
    { $group: { _id: "$signals.conceptSlug", total: { $sum: "$signals.weight" } } },
  ]);

  const asked = new Map(grouped.map((g) => [g._id, g.total]));

  const scored = conceptSlugs.map((slug) => ({
    conceptSlug: slug,
    struggleScore: SIGNAL_WEIGHTS.baseline + (asked.get(slug) ?? 0),
  }));

  const total = scored.reduce((sum, c) => sum + c.struggleScore, 0);

  // Largest-remainder apportionment: proportional rounding alone loses or gains
  // questions, and the quiz has to be exactly QUIZ_LENGTH.
  const exact = scored.map((c) => ({ ...c, ideal: (c.struggleScore / total) * QUIZ_LENGTH }));
  const counts = exact.map((c) => ({ ...c, questionCount: Math.floor(c.ideal) }));

  let remaining = QUIZ_LENGTH - counts.reduce((sum, c) => sum + c.questionCount, 0);
  const byRemainder = [...counts].sort((a, b) => b.ideal - Math.floor(b.ideal) - (a.ideal - Math.floor(a.ideal)));

  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    entry.questionCount += 1;
    remaining -= 1;
  }

  return counts
    .filter((c) => c.questionCount > 0)
    .map((c) => ({
      conceptSlug: c.conceptSlug,
      struggleScore: Number(c.struggleScore.toFixed(3)),
      questionCount: c.questionCount,
      difficulty: difficultyFor(comfortLevel, c.struggleScore),
    }))
    .sort((a, b) => b.struggleScore - a.struggleScore);
}

/**
 * Comfort sets the baseline; a high struggle score pulls it back down. Testing
 * someone at "analyse" on the exact concept they just said they don't follow
 * measures nothing useful.
 */
function difficultyFor(comfortLevel: number | undefined, struggleScore: number): Difficulty {
  const comfort = comfortLevel ?? 3;
  const struggling = struggleScore > SIGNAL_WEIGHTS.baseline + SIGNAL_WEIGHTS.first_question;

  if (comfort <= 2 || struggling) return "recall";
  if (comfort >= 5) return "analyse";
  return "apply";
}
