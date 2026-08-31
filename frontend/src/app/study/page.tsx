"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { NoteDto, ReadinessDto, TopicProgressDto, TurnDto } from "@study-loop/shared";
import { AppShell } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Loading } from "@/components/ui/Loading";
import { api } from "@/lib/api";
import { ApiRequestError } from "@/lib/api-client";
import { useGuard } from "@/lib/use-guard";

export default function StudyPage() {
  const { user, loading } = useGuard({ requireOnboarded: true });
  const router = useRouter();

  const [topics, setTopics] = useState<Array<{ id: string; subject: string; title: string }>>([]);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDto | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [progress, setProgress] = useState<TopicProgressDto[]>([]);
  const [turns, setTurns] = useState<TurnDto[]>([]);
  const [readiness, setReadiness] = useState<ReadinessDto | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const notes = await api.listNotes();
        const first = notes[0];
        if (!first) {
          setBootError("No topics have been seeded yet. Run `npm run seed` in the backend.");
          return;
        }

        if (cancelled) return;
        setTopics(notes);
        setNoteId(first.id);

        // Progress is stored per account, so a returning student sees what they
        // already did rather than an empty slate.
        const { topics: stored } = await api.progress();
        if (!cancelled) setProgress(stored);
      } catch (err) {
        if (!cancelled) {
          setBootError(err instanceof ApiRequestError ? err.message : "Could not load the notes.");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  /**
   * Each topic gets its own Q&A session. Switching starts a fresh one rather
   * than carrying the thread across, because the struggle signals a session
   * collects are what the quiz is built from -- mixing topics into one session
   * would produce a quiz spanning material the student never chose.
   */
  useEffect(() => {
    if (!user || !noteId) return;
    let cancelled = false;

    (async () => {
      setSwitching(true);
      setError(null);
      try {
        const [loaded, session] = await Promise.all([api.getNote(noteId), api.startSession(noteId)]);
        if (cancelled) return;

        setNote(loaded);
        setSessionId(session.id);

        const [existing, ready] = await Promise.all([api.listTurns(session.id), api.readiness(session.id)]);
        if (cancelled) return;

        setTurns(existing);
        setReadiness(ready);
      } catch (err) {
        if (!cancelled) {
          setBootError(err instanceof ApiRequestError ? err.message : "Could not load that topic.");
        }
      } finally {
        if (!cancelled) setSwitching(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user, noteId]);

  // Keep the newest exchange in view as the thread grows.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, asking]);

  const ask = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!sessionId || !question.trim() || asking) return;

      const asked = question.trim();
      setQuestion("");
      setAsking(true);
      setError(null);

      try {
        const turn = await api.ask(sessionId, asked);
        setTurns((prev) => [...prev, turn]);

        const [ready, stored] = await Promise.all([api.readiness(sessionId), api.progress()]);
        setReadiness(ready);
        setProgress(stored.topics);
      } catch (err) {
        setQuestion(asked); // give the question back rather than losing it
        setError(err instanceof ApiRequestError ? err.message : "That didn't go through. Try again.");
      } finally {
        setAsking(false);
      }
    },
    [sessionId, question, asking]
  );

  async function startQuiz() {
    if (!sessionId) return;
    setStarting(true);
    setError(null);
    try {
      const quiz = await api.createQuiz(sessionId);
      router.push(`/quiz/${quiz.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not build your quiz.");
      setStarting(false);
    }
  }

  if (loading || !user) return <AppShell><Loading label="Loading your account" /></AppShell>;
  if (bootError) {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg px-6 py-16"><Callout tone="error" title="Nothing to study yet">{bootError}</Callout></div>
      </AppShell>
    );
  }
  if (!note) return <AppShell><Loading label="Loading the topic" /></AppShell>;

  const current = progress.find((p) => p.noteId === noteId);
  const covered = new Set(readiness?.coveredConcepts ?? []);
  const canQuiz = readiness?.ready ?? false;

  return (
    <AppShell>
      {/* Two panes filling the viewport: notes to read on the left, the
          conversation on the right. Neither is a narrow centred column. */}
      {/*
        Two independent scroll panes side by side on desktop. On a phone that
        arrangement is wrong: stacked, each pane became a short clipped box and
        the note body -- the entire point of the screen -- could not be reached.
        Below lg the page scrolls as one document instead.
      */}
      <div className="grid h-auto grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* --- Notes --- */}
        <section className="scroll-pane border-line lg:min-h-0 lg:overflow-y-auto lg:border-r">
          <div className="mx-auto max-w-3xl px-6 py-8 lg:px-10">
            {topics.length > 1 && (
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <span className="mr-1 font-display text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                  Topic
                </span>
                {topics.map((t) => {
                  const active = t.id === noteId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setNoteId(t.id)}
                      disabled={switching || active}
                      aria-current={active ? "true" : undefined}
                      className={`rounded-full border px-3 py-1.5 font-display text-xs font-semibold transition-colors
                        disabled:cursor-default
                        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                        ${active
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-surface text-ink-soft hover:border-accent hover:text-accent"}`}
                    >
                      {t.title}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
              {note.subject}
            </p>
            <h1 className="mt-1.5 font-display text-3xl font-extrabold tracking-tight">{note.title}</h1>

            {current && (current.questionsAsked > 0 || current.quizzesTaken > 0) && (
              <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
                <div className="bg-surface px-4 py-3">
                  <dt className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                    Questions asked
                  </dt>
                  <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">
                    {current.questionsAsked}
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                    Concepts covered
                  </dt>
                  <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">
                    {current.conceptsCovered}
                    <span className="text-sm font-semibold text-muted">/{current.totalConcepts}</span>
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="font-display text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                    Best score
                  </dt>
                  <dd className="mt-0.5 font-display text-xl font-bold tabular-nums">
                    {current.bestScore === null ? (
                      <span className="text-sm font-semibold text-muted">Not taken</span>
                    ) : (
                      <>
                        {current.bestScore}
                        <span className="text-sm font-semibold text-muted">%</span>
                      </>
                    )}
                  </dd>
                </div>
              </dl>
            )}

            {current?.lastResultId && (
              <p className="mt-2 text-xs text-muted">
                <Link href={`/results/${current.lastResultId}`} className="text-accent underline underline-offset-2">
                  See your last result
                </Link>{" "}
                &middot; {current.quizzesTaken} quiz{current.quizzesTaken === 1 ? "" : "zes"} taken
              </p>
            )}

            <div className="mt-5 rounded-xl border border-line bg-surface p-4">
              <p className="font-display text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                Concepts in this note
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {note.concepts.map((c) => {
                  const done = covered.has(c.slug);
                  return (
                    <button
                      key={c.slug}
                      title={c.summary}
                      onMouseEnter={() => setHighlight(c.chunkOrdinals[0] ?? null)}
                      onMouseLeave={() => setHighlight(null)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-display font-semibold transition-colors
                        ${done
                          ? "border-accent bg-accent text-white"
                          : "border-line bg-surface text-ink-soft hover:border-accent hover:text-accent"}`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2.5 text-xs text-muted">
                Filled in as you ask about them. {covered.size} of {note.concepts.length} so far.
              </p>
            </div>

            <article className="mt-7 text-[15px]">
              <Markdown>{note.bodyMd}</Markdown>
            </article>
          </div>
        </section>

        {/* --- Q&A --- */}
        <section className="flex flex-col border-t border-line bg-surface lg:min-h-0 lg:border-t-0">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 lg:shrink-0">
            <div>
              <h2 className="font-display text-sm font-bold">Ask about the notes</h2>
              <p className="text-xs text-muted">
                {turns.length === 0
                  ? "Anything you're not following."
                  : `${turns.length} question${turns.length === 1 ? "" : "s"} asked`}
              </p>
            </div>
            <Button onClick={() => void startQuiz()} loading={starting} disabled={!canQuiz || starting}
              title={canQuiz ? undefined : "Ask a few questions first"}>
              {starting ? "Building" : "Start quiz"}
            </Button>
          </div>

          <div ref={threadRef} className="scroll-pane space-y-5 px-5 py-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {turns.length === 0 && !asking && (
              <div className="rounded-xl border border-dashed border-line p-5">
                <p className="text-sm text-ink-soft">
                  Try: <em>&ldquo;Why is g the same for a feather and a hammer?&rdquo;</em> or{" "}
                  <em>&ldquo;What&rsquo;s the difference between mass and weight?&rdquo;</em>
                </p>
                <p className="mt-2 text-xs text-muted">
                  Answers come only from these notes, and cite the passage they came from.
                </p>
              </div>
            )}

            {turns.map((t) => (
              <div key={t.id} data-turn className="space-y-2.5">
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-white">
                  {t.question}
                </p>
                <div className="w-fit max-w-[92%] rounded-2xl rounded-bl-sm bg-sunk px-3.5 py-2.5">
                  <p className="text-sm leading-relaxed text-ink">{t.answer}</p>

                  {t.citations.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
                      {t.citations.map((c) => (
                        <span key={c.chunkId} title={c.excerpt}
                          className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                          passage {c.ordinal}
                        </span>
                      ))}
                    </div>
                  )}

                  {t.concepts.length > 0 && (
                    <p className="mt-2 text-[11px] text-muted">
                      Logged against: {t.concepts.join(", ")}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {asking && (
              <div className="w-fit rounded-2xl rounded-bl-sm bg-sunk px-4 py-3">
                <span className="flex gap-1.5" aria-label="Thinking">
                  <span className="dot h-1.5 w-1.5 rounded-full bg-muted" />
                  <span className="dot h-1.5 w-1.5 rounded-full bg-muted" />
                  <span className="dot h-1.5 w-1.5 rounded-full bg-muted" />
                </span>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 border-t border-line bg-surface px-5 py-4 lg:static lg:shrink-0">
            {error && <div className="mb-3"><Callout tone="error">{error}</Callout></div>}
            {!canQuiz && readiness && (
              <p className="mb-2.5 text-xs text-muted">
                Ask {Math.max(0, 3 - readiness.turnCount)} more question
                {3 - readiness.turnCount === 1 ? "" : "s"} to unlock the quiz.
              </p>
            )}
            <form onSubmit={ask} className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What don't you follow?"
                maxLength={500}
                className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <Button type="submit" disabled={!question.trim() || asking}>Ask</Button>
            </form>
          </div>
        </section>
      </div>

      {highlight !== null && <span className="sr-only">Passage {highlight} teaches this concept</span>}
    </AppShell>
  );
}
