"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Loading } from "@/components/ui/Loading";
import { api } from "@/lib/api";
import { ApiRequestError } from "@/lib/api-client";
import { useGuard } from "@/lib/use-guard";
import { useSession } from "@/lib/session";

const YEARS = [1, 2, 3, 4];
const BRANCHES = ["Computer Science", "Mechanical", "Electrical", "Civil", "Electronics", "Other"];
const COMFORT = [
  { value: 1, label: "Not at all", hint: "I'm starting from scratch" },
  { value: 2, label: "A little", hint: "I've seen it but it didn't stick" },
  { value: 3, label: "Somewhat", hint: "I get the basics" },
  { value: 4, label: "Fairly", hint: "I can solve standard problems" },
  { value: 5, label: "Very", hint: "I want the harder questions" },
];
const GOALS = ["Pass the exam", "Understand it properly", "Revise before a test", "Get ahead of the class"];

export default function OnboardingPage() {
  const { user, loading } = useGuard();
  const { refresh } = useSession();
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [year, setYear] = useState<number | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [comfortLevel, setComfortLevel] = useState<number | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !user) {
    return <AppShell><Loading label="Loading your account" /></AppShell>;
  }

  const steps = [
    {
      q: "Which year are you in?",
      why: "Sets the level we pitch explanations at.",
      options: YEARS.map((y) => ({ key: String(y), label: `Year ${y}`, hint: null })),
      selected: year === null ? null : String(year),
      pick: (v: string) => setYear(Number(v)),
    },
    {
      q: "What are you studying?",
      why: "Lets us reach for examples from your field.",
      options: BRANCHES.map((b) => ({ key: b, label: b, hint: null })),
      selected: branch,
      pick: setBranch,
    },
    {
      q: "How comfortable are you with gravitation?",
      why: "This one directly sets how hard your quiz questions are.",
      options: COMFORT.map((c) => ({ key: String(c.value), label: c.label, hint: c.hint })),
      selected: comfortLevel === null ? null : String(comfortLevel),
      pick: (v: string) => setComfortLevel(Number(v)),
    },
    {
      q: "What are you here for?",
      why: "Shapes the tone of the feedback you get at the end.",
      options: GOALS.map((g) => ({ key: g, label: g, hint: null })),
      selected: goal,
      pick: setGoal,
    },
  ];

  const current = steps[step]!;
  const isLast = step === steps.length - 1;

  async function choose(value: string) {
    current.pick(value);
    setError(null);

    if (!isLast) {
      setStep(step + 1);
      return;
    }

    // Last answer is not in state yet on this render, so pass it explicitly.
    setBusy(true);
    try {
      await api.saveOnboarding({
        year: year!,
        branch: branch!,
        comfortLevel: comfortLevel!,
        goal: value,
      });
      await refresh();
      router.replace("/study");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save your answers.");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-6 py-8 lg:px-10">
        {/* Progress: four questions, and you can see exactly where you are. */}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-sunk"}`}
              />
            ))}
          </div>
          <span className="font-mono text-xs text-muted">
            {step + 1}/{steps.length}
          </span>
        </div>

        <div className="flex flex-1 flex-col justify-center py-10">
          <h1 className="max-w-2xl font-display text-3xl font-extrabold tracking-tight lg:text-4xl">
            {current.q}
          </h1>
          <p className="mt-2 text-muted">{current.why}</p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {current.options.map((o) => {
              const active = current.selected === o.key;
              return (
                <button
                  key={o.key}
                  onClick={() => void choose(o.key)}
                  disabled={busy}
                  className={`rounded-xl border p-4 text-left transition-all disabled:opacity-60
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                    ${active
                      ? "border-accent bg-accent-soft ring-1 ring-accent"
                      : "border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/40"}`}
                >
                  <span className="block font-display font-bold text-ink">{o.label}</span>
                  {o.hint && <span className="mt-0.5 block text-sm text-muted">{o.hint}</span>}
                </button>
              );
            })}
          </div>

          {error && <div className="mt-6 max-w-md"><Callout tone="error">{error}</Callout></div>}

          {step > 0 && (
            <div className="mt-8">
              <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                &larr; Back
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
