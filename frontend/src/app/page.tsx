"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { ApiRequestError } from "@/lib/api-client";
import { api } from "@/lib/api";
import { setSessionHint, useSession } from "@/lib/session";

const STAGES = [
  ["Notes", "Three physics topics, each broken into the concepts it contains."],
  ["Ask", "Put your questions to them. Answers come from the notes, cited back to the passage."],
  ["Quiz", "Ten questions, weighted towards whatever you asked about most."],
  ["Result", "A score per concept, kept against your account, plus a copy by email."],
];

type Mode = "signin" | "signup";
type Step = "credentials" | "code";

export default function SignInPage() {
  const router = useRouter();
  const { user, loading, refresh } = useSession();

  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(user.onboarded ? "/study" : "/onboarding");
  }, [loading, user, router]);

  function describe(err: unknown, fallback: string) {
    if (err instanceof ApiRequestError) return err.message;
    return `Could not reach the server. Check that the API is running on ${process.env.NEXT_PUBLIC_API_URL ?? "the configured URL"}.`;
  }

  /** Step one: prove the password. A correct password alone issues no session. */
  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = mode === "signup" ? await api.register(email, password) : await api.login(email, password);

      // The server decides whether a code is needed; the form follows. When
      // verification is off the password alone has already established the
      // session, so go straight in rather than showing a step that would sit
      // there waiting for a code nobody sent.
      if (!res.requiresCode) {
        setSessionHint(true);
        await refresh();
        router.replace(res.onboarded ? "/study" : "/onboarding");
        return;
      }

      setDevCode(res.devCode ?? null);
      if (res.devCode) setCode(res.devCode);
      setStep("code");
    } catch (err) {
      setError(describe(err, "Could not sign you in."));
    } finally {
      setBusy(false);
    }
  }

  /** Step two: prove the address. Only this issues a session. */
  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { onboarded } = await api.verifyCode(email, code);
      setSessionHint(true);
      await refresh();
      router.replace(onboarded ? "/study" : "/onboarding");
    } catch (err) {
      setError(describe(err, "Could not verify that code."));
      setBusy(false);
    }
  }

  function backToCredentials() {
    setStep("credentials");
    setCode("");
    setDevCode(null);
    setError(null);
  }

  const inputClass =
    "rounded-lg border border-line bg-surface px-3.5 py-2.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  const labelClass = "font-display text-xs font-bold uppercase tracking-[0.1em] text-muted";

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      {/*
        Source order puts the pitch first so it leads on a wide screen. On a
        phone that pushed the actual sign-in form entirely below the fold -- you
        landed on a login page with no login visible -- so the panel is ordered
        second there and the form comes first.
      */}
      <section className="order-2 flex flex-col justify-between bg-ink px-8 py-10 text-white lg:order-1 lg:px-14 lg:py-14">
        <div>
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-accent-soft">
            Physics &middot; Mechanics
          </p>
          <h1 className="mt-3 max-w-xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight lg:text-5xl">
            The questions you ask are the syllabus.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70">
            Most quizzes test the whole chapter evenly. This one watches which parts you had to ask
            about, and weights itself towards those.
          </p>
        </div>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-white/15 bg-white/15 sm:grid-cols-2">
          {STAGES.map(([title, body], i) => (
            <li key={title} className="bg-ink p-5">
              <span className="font-mono text-xs font-semibold text-accent-soft/70">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-1 font-display text-base font-bold">{title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-white/60">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="order-1 flex items-center justify-center px-8 py-12 lg:order-2 lg:px-14 lg:py-14">
        <div className="w-full max-w-sm">
          {step === "credentials" ? (
            <form onSubmit={submitCredentials} className="grid gap-5">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight">
                  {mode === "signup" ? "Create your account" : "Sign in"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {mode === "signup"
                    ? "Pick a password you'll remember. You can start straight away."
                    : "Welcome back."}
                </p>
              </div>

              <label className="grid gap-1.5">
                <span className={labelClass}>College email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@college.edu"
                  className={inputClass}
                />
              </label>

              <label className="grid gap-1.5">
                <span className={labelClass}>Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                  className={inputClass}
                />
                {mode === "signup" && (
                  <span className="text-xs text-muted">
                    At least 8 characters, with a letter and a number.
                  </span>
                )}
              </label>

              {error && <Callout tone="error">{error}</Callout>}

              <Button type="submit" size="lg" loading={busy}>
                {busy ? "Checking" : mode === "signup" ? "Create account" : "Continue"}
              </Button>

              <p className="text-sm text-muted">
                {mode === "signup" ? "Already have an account?" : "First time here?"}{" "}
                <button
                  type="button"
                  onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); }}
                  className="text-accent underline underline-offset-2"
                >
                  {mode === "signup" ? "Sign in" : "Create an account"}
                </button>
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode} className="grid gap-5">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight">Check your email</h2>
                <p className="mt-1 text-sm text-muted">
                  {devCode ? (
                    <>That address can&rsquo;t receive mail yet, so the code is shown below.</>
                  ) : (
                    <>
                      Your password checked out. We sent a six-digit code to{" "}
                      <span className="text-ink">{email}</span>. It expires in ten minutes.
                    </>
                  )}
                </p>
              </div>

              {devCode && (
                <div className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3">
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.1em] text-warn">
                    Development mode
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Resend only delivers to the account owner&rsquo;s address until you verify a
                    domain, so the code is filled in for you. This never happens in production.
                  </p>
                </div>
              )}

              <label className="grid gap-1.5">
                <span className={labelClass}>Code</span>
                <input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em]`}
                />
              </label>

              {error && <Callout tone="error">{error}</Callout>}

              <Button type="submit" size="lg" loading={busy}>
                {busy ? "Verifying" : "Verify and continue"}
              </Button>

              <button
                type="button"
                onClick={backToCredentials}
                className="text-sm text-muted underline underline-offset-2 hover:text-ink"
              >
                Use a different email
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
