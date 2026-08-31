"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { BAND_LABEL, type ResultDto } from "@study-loop/shared";
import { AppShell } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Loading } from "@/components/ui/Loading";
import { MasteryBar } from "@/components/ui/MasteryBar";
import { api } from "@/lib/api";
import { ApiRequestError } from "@/lib/api-client";
import { useGuard } from "@/lib/use-guard";

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useGuard({ requireOnboarded: true });

  const [result, setResult] = useState<ResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailed, setEmailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.getResult(id)
      .then((r) => {
        setResult(r);
        setEmailed(r.emailStatus === "sent" || r.emailStatus === "delivered");
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : "Could not load this result."));
  }, [user, id]);

  async function sendEmail() {
    setEmailing(true);
    setError(null);
    try {
      await api.emailResult(id);
      setEmailed(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not send the email.");
    } finally {
      setEmailing(false);
    }
  }

  if (loading || !user) return <AppShell><Loading label="Loading your account" /></AppShell>;
  if (error && !result) {
    return <AppShell><div className="mx-auto max-w-lg px-6 py-16"><Callout tone="error" title="Result unavailable">{error}</Callout></div></AppShell>;
  }
  if (!result) return <AppShell><Loading label="Marking your answers" /></AppShell>;

  const correct = result.perConcept.reduce((sum, c) => sum + c.correct, 0);
  const asked = result.perConcept.reduce((sum, c) => sum + c.asked, 0);
  const weakest = result.perConcept.filter((c) => c.mastery < 0.75);

  return (
    <AppShell>
      <div className="scroll-pane h-full overflow-y-auto">
        {/* Score band spans the full width; the detail sits in two columns below. */}
        <div className="border-b border-line bg-ink px-6 py-10 text-white lg:px-10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6">
            <div>
              <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-accent-soft">
                Result
              </p>
              <p className="mt-2 font-display text-6xl font-extrabold tracking-tight lg:text-7xl">
                {result.score}
                <span className="text-3xl text-white/50">%</span>
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-white/80">
                {BAND_LABEL[result.band]} &middot; {correct} of {asked} correct
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {emailed ? (
                <span className="rounded-lg border border-white/20 px-4 py-2.5 text-sm text-white/70">
                  Sent to {user.email}
                </span>
              ) : (
                <Button variant="secondary" size="lg" onClick={() => void sendEmail()} loading={emailing}>
                  {emailing ? "Sending" : "Email me this result"}
                </Button>
              )}
              <Link
                href="/study"
                className="rounded-lg bg-accent px-6 py-3 font-display font-semibold text-white transition-colors hover:bg-[#0c586a]"
              >
                Back to the notes
              </Link>
            </div>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1.15fr_1fr] lg:px-10">
          {/* Weakest first: the ordering is the advice. */}
          <section>
            <h2 className="font-display text-lg font-bold tracking-tight">By concept</h2>
            <p className="mt-1 text-sm text-muted">Weakest first — that&rsquo;s your revision order.</p>

            <div className="mt-5 grid gap-3.5">
              {result.perConcept.map((c) => (
                <div key={c.conceptSlug} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-sm font-bold text-ink">{c.label}</h3>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                      {c.correct}/{c.asked}
                    </span>
                  </div>
                  <div className="mt-2.5"><MasteryBar mastery={c.mastery} /></div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold tracking-tight">What to do next</h2>
            <p className="mt-1 text-sm text-muted">Based on the pattern of your answers, not just the score.</p>

            <div className="mt-5 rounded-xl border border-line bg-surface p-5 text-[15px]">
              {result.feedbackMd ? (
                <Markdown>{result.feedbackMd}</Markdown>
              ) : (
                <p className="text-sm text-muted">
                  Written feedback isn&rsquo;t available for this attempt. Your score and the concept
                  breakdown are complete regardless.
                </p>
              )}
            </div>

            {weakest.length > 0 && (
              <div className="mt-5 rounded-xl border border-line bg-surface p-5">
                <p className="font-display text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                  Worth re-reading
                </p>
                <ul className="mt-2.5 grid gap-1.5">
                  {weakest.slice(0, 3).map((c) => (
                    <li key={c.conceptSlug} className="text-sm text-ink-soft">
                      {c.label} — {Math.round(c.mastery * 100)}%
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <div className="mt-5"><Callout tone="error">{error}</Callout></div>}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
