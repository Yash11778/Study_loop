"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuizDto } from "@study-loop/shared";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Loading } from "@/components/ui/Loading";
import { api } from "@/lib/api";
import { ApiRequestError } from "@/lib/api-client";
import { useGuard } from "@/lib/use-guard";

const DIFFICULTY_LABEL = { recall: "Recall", apply: "Apply", analyse: "Analyse" } as const;

export default function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useGuard({ requireOnboarded: true });
  const router = useRouter();

  const [quiz, setQuiz] = useState<QuizDto | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-question timing, for the result breakdown.
  const startedAt = useRef<number>(Date.now());
  const spent = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;
    api.getQuiz(id)
      .then(setQuiz)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : "Could not load this quiz."));
  }, [user, id]);

  const question = quiz?.questions[index];
  const answered = useMemo(() => Object.keys(answers).length, [answers]);

  if (loading || !user) return <AppShell><Loading label="Loading your account" /></AppShell>;
  if (error && !quiz) {
    return <AppShell><div className="mx-auto max-w-lg px-6 py-16"><Callout tone="error" title="Quiz unavailable">{error}</Callout></div></AppShell>;
  }
  if (!quiz || !question) return <AppShell><Loading label="Loading your quiz" /></AppShell>;

  const isLast = index === quiz.questions.length - 1;
  const chosen = answers[question.id];

  function choose(optionIndex: number) {
    if (!question) return;
    spent.current[question.id] = Date.now() - startedAt.current;
    setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }));
  }

  function next() {
    startedAt.current = Date.now();
    setIndex((i) => Math.min(i + 1, quiz!.questions.length - 1));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const { resultId } = await api.submitAttempt(quiz!.id, {
        answers: quiz!.questions.map((q) => ({
          questionId: q.id,
          chosenIndex: answers[q.id] ?? 0,
          msSpent: spent.current[q.id] ?? 0,
        })),
      });
      router.replace(`/results/${resultId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not submit your answers.");
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Progress across the full width -- position in the quiz is always visible. */}
        <div className="shrink-0 border-b border-line bg-surface px-6 py-3 lg:px-10">
          <div className="mx-auto flex max-w-5xl items-center gap-4">
            <div className="flex flex-1 gap-1">
              {quiz.questions.map((q, i) => (
                <div
                  key={q.id}
                  className={`h-1.5 flex-1 rounded-full transition-colors
                    ${i === index ? "bg-accent" : answers[q.id] !== undefined ? "bg-accent/40" : "bg-sunk"}`}
                />
              ))}
            </div>
            <span className="shrink-0 font-mono text-xs text-muted">
              {index + 1}/{quiz.questions.length}
            </span>
          </div>
        </div>

        <div className="scroll-pane min-h-0 flex-1 overflow-y-auto px-6 py-10 lg:px-10">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-2">
              <span className="rounded border border-line bg-surface px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                {DIFFICULTY_LABEL[question.difficulty]}
              </span>
              <span className="font-mono text-[11px] text-muted">{question.conceptSlug}</span>
            </div>

            <h1 className="mt-4 font-display text-2xl font-bold leading-snug tracking-tight lg:text-3xl">
              {question.stem}
            </h1>

            <div className="mt-7 grid gap-2.5">
              {question.options.map((option, i) => {
                const active = chosen === i;
                return (
                  <button
                    key={i}
                    onClick={() => choose(i)}
                    className={`flex items-start gap-3.5 rounded-xl border p-4 text-left transition-all
                      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                      ${active
                        ? "border-accent bg-accent-soft ring-1 ring-accent"
                        : "border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/40"}`}
                  >
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-display text-xs font-bold
                      ${active ? "border-accent bg-accent text-white" : "border-line text-muted"}`}>
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="text-[15px] leading-relaxed text-ink">{option}</span>
                  </button>
                );
              })}
            </div>

            {error && <div className="mt-6"><Callout tone="error">{error}</Callout></div>}
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-surface px-6 py-4 lg:px-10">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
            <p className="text-sm text-muted">
              {answered} of {quiz.questions.length} answered
              {answered < quiz.questions.length && " — unanswered questions count as wrong"}
            </p>

            {isLast ? (
              <Button size="lg" onClick={() => void submit()} loading={submitting} disabled={submitting}>
                {submitting ? "Marking" : "Finish and see result"}
              </Button>
            ) : (
              <Button size="lg" onClick={next} disabled={chosen === undefined}>
                Next question &rarr;
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
