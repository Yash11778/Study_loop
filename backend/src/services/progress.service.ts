import mongoose, { type Types } from "mongoose";
import type { TopicProgressDto } from "@study-loop/shared";
import { Note } from "@/models/Note";
import { QnaSession } from "@/models/QnaSession";
import { QnaTurn } from "@/models/QnaTurn";
import { Quiz } from "@/models/Quiz";
import { Attempt } from "@/models/Attempt";
import { Result } from "@/models/Result";

/**
 * What this student has done, per topic.
 *
 * Everything here is derived from records that already exist rather than kept
 * in a separate counter, so it cannot drift out of step with the underlying
 * turns and attempts -- and a replayed or deleted record corrects the numbers
 * automatically.
 */
export async function getProgress(userId: Types.ObjectId): Promise<TopicProgressDto[]> {
  const notes = await Note.find({}, { subject: 1, title: 1, concepts: 1 }).sort({ createdAt: 1 }).lean();

  const sessions = await QnaSession.find({ userId }).lean();
  const sessionByNote = new Map(sessions.map((s) => [String(s.noteId), s]));

  // One aggregation for all topics rather than a query per topic.
  const turnStats = await QnaTurn.aggregate<{
    _id: mongoose.Types.ObjectId;
    turns: number;
    concepts: string[];
    lastAt: Date;
  }>([
    { $match: { userId } },
    { $group: { _id: "$sessionId", turns: { $sum: 1 }, concepts: { $push: "$signals.conceptSlug" }, lastAt: { $max: "$createdAt" } } },
  ]);
  const turnsBySession = new Map(turnStats.map((t) => [String(t._id), t]));

  const quizzes = await Quiz.find({ userId }, { noteId: 1 }).lean();
  const quizIdsByNote = new Map<string, string[]>();
  for (const q of quizzes) {
    const key = String(q.noteId);
    quizIdsByNote.set(key, [...(quizIdsByNote.get(key) ?? []), String(q._id)]);
  }

  const attempts = await Attempt.find({ userId, submittedAt: { $exists: true } }, { quizId: 1 }).lean();
  const attemptIdsByQuiz = new Map(attempts.map((a) => [String(a.quizId), String(a._id)]));

  const results = await Result.find({ userId }).sort({ createdAt: 1 }).lean();
  const resultsByAttempt = new Map(results.map((r) => [String(r.attemptId), r]));

  return notes.map((note) => {
    const noteId = String(note._id);
    const session = sessionByNote.get(noteId);
    const stats = session ? turnsBySession.get(String(session._id)) : undefined;

    // signals is an array per turn, so the push above yields an array of arrays.
    const covered = new Set((stats?.concepts ?? []).flat());

    const topicResults = (quizIdsByNote.get(noteId) ?? [])
      .map((quizId) => attemptIdsByQuiz.get(quizId))
      .filter((id): id is string => Boolean(id))
      .map((attemptId) => resultsByAttempt.get(attemptId))
      .filter((r) => r !== undefined);

    const scores = topicResults.map((r) => r.score);
    const last = topicResults.at(-1);

    return {
      noteId,
      subject: note.subject,
      title: note.title,
      questionsAsked: stats?.turns ?? 0,
      conceptsCovered: covered.size,
      totalConcepts: note.concepts.length,
      quizzesTaken: topicResults.length,
      bestScore: scores.length ? Math.max(...scores) : null,
      lastScore: last?.score ?? null,
      lastResultId: last ? String(last._id) : null,
      lastActiveAt: stats?.lastAt ? new Date(stats.lastAt).toISOString() : null,
    };
  });
}
