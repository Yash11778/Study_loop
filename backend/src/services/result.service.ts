import { z } from "zod";
import mongoose, { type Types } from "mongoose";
const ObjectId = mongoose.Types.ObjectId;
import { BAND_LABEL, bandFor, type ResultDto, type SubmitAttemptRequest } from "@study-loop/shared";
import { Attempt } from "@/models/Attempt";
import { EmailDelivery } from "@/models/EmailDelivery";
import { Note } from "@/models/Note";
import { Quiz } from "@/models/Quiz";
import { Result } from "@/models/Result";
import { User } from "@/models/User";
import { generate } from "./ai/gateway";
import { sendResultEmail } from "./email.service";
import { conflict, forbidden, notFound } from "@/utils/errors";
import { logger } from "@/utils/logger";

/**
 * Grades an attempt against the answer key held in the database. The client
 * sends only which option it chose; correctness is decided here and nowhere
 * else.
 */
export async function submitAttempt(
  quizId: string,
  userId: Types.ObjectId,
  body: SubmitAttemptRequest
): Promise<{ resultId: string }> {
  if (!ObjectId.isValid(quizId)) throw notFound("Quiz");

  const quiz = await Quiz.findById(quizId);
  if (!quiz) throw notFound("Quiz");
  if (!quiz.userId.equals(userId)) throw forbidden("That quiz belongs to someone else.");

  const already = await Attempt.findOne({ quizId: quiz._id, userId });
  if (already?.submittedAt) {
    const prior = await Result.findOne({ attemptId: already._id }).select("_id");
    if (prior) return { resultId: String(prior._id) };
    throw conflict("You have already submitted this quiz.");
  }

  const keys = new Map(quiz.questions.map((q) => [String(q._id), q]));

  const answers = body.answers
    .filter((a) => keys.has(a.questionId))
    .map((a) => ({
      questionId: new ObjectId(a.questionId),
      chosenIndex: a.chosenIndex,
      isCorrect: keys.get(a.questionId)!.correctIndex === a.chosenIndex,
      msSpent: a.msSpent,
    }));

  const attempt = await Attempt.findOneAndUpdate(
    { quizId: quiz._id, userId },
    { $set: { answers, submittedAt: new Date() }, $setOnInsert: { startedAt: new Date() } },
    { returnDocument: "after", upsert: true }
  );
  if (!attempt) throw notFound("Attempt");

  // Unanswered questions count as wrong -- skipping is not a way to protect a score.
  const score = Math.round((answers.filter((a) => a.isCorrect).length / quiz.questions.length) * 100);

  const note = await Note.findById(quiz.noteId).select("concepts").lean();
  const labels = new Map(note?.concepts.map((c) => [c.slug, c.label]) ?? []);

  const perConceptMap = new Map<string, { asked: number; correct: number }>();
  for (const q of quiz.questions) {
    const entry = perConceptMap.get(q.conceptSlug) ?? { asked: 0, correct: 0 };
    entry.asked += 1;
    if (answers.find((a) => String(a.questionId) === String(q._id))?.isCorrect) entry.correct += 1;
    perConceptMap.set(q.conceptSlug, entry);
  }

  const perConcept = [...perConceptMap.entries()]
    .map(([slug, v]) => ({
      conceptSlug: slug,
      label: labels.get(slug) ?? slug,
      asked: v.asked,
      correct: v.correct,
      mastery: v.asked === 0 ? 0 : v.correct / v.asked,
    }))
    .sort((a, b) => a.mastery - b.mastery);

  const result = await Result.findOneAndUpdate(
    { attemptId: attempt._id },
    { $set: { userId, score, band: bandFor(score), perConcept } },
    { returnDocument: "after", upsert: true }
  );
  if (!result) throw notFound("Result");

  return { resultId: String(result._id) };
}

const feedbackSchema = z.object({
  feedbackMd: z.string().min(40),
});

/**
 * Written feedback, generated once and cached on the result. Gemini leads this
 * task -- it reads the whole per-concept breakdown and the note's concept list,
 * and reads better over long context than the latency-optimised model does.
 */
export async function ensureFeedback(resultId: string, userId: Types.ObjectId) {
  const result = await Result.findById(resultId);
  if (!result) throw notFound("Result");
  if (!result.userId.equals(userId)) throw forbidden("That result belongs to someone else.");
  if (result.feedbackMd) return result;

  const breakdown = result.perConcept
    .map((c) => `- ${c.label}: ${c.correct}/${c.asked} correct`)
    .join("\n");

  try {
    const { data } = await generate({
      task: "result.feedback",
      schema: feedbackSchema,
      temperature: 0.4,
      // Three short paragraphs.
      maxTokens: 700,
      userId: String(userId),
      system:
        "You write short, direct feedback for an undergraduate after a physics quiz. " +
        "Be specific about what the pattern of answers suggests they have and have not got. " +
        "No praise padding, no exclamation marks, no motivational filler. " +
        "Name the one or two things worth revisiting first and say why, in that order. " +
        "Three short paragraphs at most, plain Markdown.",
      user: `Score: ${result.score}%\n\nPer concept:\n${breakdown}\n\nReply as JSON: {"feedbackMd": string}`,
    });

    result.feedbackMd = data.feedbackMd;
    await result.save();
  } catch (err) {
    // Feedback is an enhancement. A student who finished a quiz still gets
    // their score and breakdown if the model is down.
    logger.error({ err, resultId }, "feedback generation failed");
  }

  return result;
}

export async function getResult(resultId: string, userId: Types.ObjectId): Promise<ResultDto> {
  if (!ObjectId.isValid(resultId)) throw notFound("Result");

  const result = await ensureFeedback(resultId, userId);
  const delivery = await EmailDelivery.findOne({ resultId: result._id }).select("status").lean();

  return {
    id: String(result._id),
    score: result.score,
    band: result.band,
    perConcept: result.perConcept.map((c) => ({
      conceptSlug: c.conceptSlug,
      label: c.label,
      asked: c.asked,
      correct: c.correct,
      mastery: c.mastery,
    })),
    feedbackMd: result.feedbackMd ?? null,
    emailStatus: delivery?.status ?? null,
  };
}

/**
 * Idempotent by the unique index on resultId: a double-click sends one mail.
 * The delivery row is written before the send so a crash mid-flight leaves
 * something for the retry cron to find.
 */
export async function emailResult(resultId: string, userId: Types.ObjectId) {
  const result = await ensureFeedback(resultId, userId);

  const user = await User.findById(userId).select("email").lean();
  if (!user) throw notFound("User");

  const existing = await EmailDelivery.findOne({ resultId: result._id });
  if (existing && ["sent", "delivered"].includes(existing.status)) {
    return { ok: true as const, alreadySent: true };
  }

  const delivery =
    existing ??
    (await EmailDelivery.create({ resultId: result._id, to: user.email, status: "pending" }));

  try {
    const weakest = result.perConcept.slice(0, 3).map((c) => ({ label: c.label, mastery: c.mastery }));

    const { id } = await sendResultEmail({
      to: user.email,
      score: result.score,
      bandLabel: BAND_LABEL[result.band],
      weakest,
      resultId: String(result._id),
    });

    delivery.set({ status: "sent", resendId: id, sentAt: new Date(), attempts: delivery.attempts + 1 });
    await delivery.save();

    return { ok: true as const, alreadySent: false };
  } catch (err) {
    delivery.set({
      status: "failed",
      attempts: delivery.attempts + 1,
      lastError: err instanceof Error ? err.message : String(err),
    });
    await delivery.save();
    throw err;
  }
}

/** Re-sends deliveries that failed. Driven by the cron endpoint. */
export async function retryFailedDeliveries(limit = 20) {
  const stuck = await EmailDelivery.find({ status: { $in: ["pending", "failed"] }, attempts: { $lt: 4 } })
    .limit(limit)
    .lean();

  let retried = 0;
  for (const d of stuck) {
    const result = await Result.findById(d.resultId);
    if (!result) continue;
    try {
      await emailResult(String(result._id), result.userId);
      retried += 1;
    } catch (err) {
      logger.warn({ err, resultId: String(d.resultId) }, "retry failed");
    }
  }
  return { examined: stuck.length, retried };
}
