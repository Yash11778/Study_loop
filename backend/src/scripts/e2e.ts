/**
 * End-to-end check of the whole loop against a throwaway in-memory replica set.
 *
 *   npm run e2e --workspace=backend
 *
 * Exercises: seed -> sign in -> onboarding -> Q&A -> quiz -> submit -> result.
 * It makes real Groq/Gemini calls, so it costs quota and takes a minute. It is
 * a smoke test of the wiring, not a unit test suite.
 */
import "dotenv/config";
import { MongoMemoryReplSet } from "mongodb-memory-server";

async function main() {
  console.log("starting in-memory replica set (needed for transactions)...");
  const replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = replset.getUri();
  process.env.MONGODB_DB = "study_loop_e2e";
  process.env.JWT_SECRET ??= "e2e-secret-that-is-definitely-long-enough-ok";
  process.env.APP_URL ??= "http://localhost:3000";
  // Never send real mail from a test run.
  delete process.env.RESEND_API_KEY;

  // Imported after the env is rewritten -- config/env validates at import time.
  const { connectDB } = await import("@/db/connection");
  const { createApp } = await import("@/app");
  const mongoose = (await import("mongoose")).default;

  await connectDB();

  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0]!;
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = text; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return json as never;
  };

  const step = async (label: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    const out = await fn();
    console.log(`  ok  ${label.padEnd(28)} ${Date.now() - t}ms`);
    return out;
  };

  try {
    console.log("\nseeding...");
    // One topic is enough for an end-to-end check, and seeding all three would
    // triple the provider spend of every run.
    const { seedTopic, SEED_TOPICS } = await import("@/services/seed.service");
    const noteId = (await step("seed topic + embeddings", () => seedTopic(SEED_TOPICS[0]!, true))) as string;

    console.log("\nrunning the loop...");
    await step("health", () => call("GET", "/api/health"));

    // Password first, then the emailed code. The code is read straight from the
    // collection: no mail is sent in a test run.
    await step("register (email + password)", () =>
      call("POST", "/api/auth/register", { email: "student@college.edu", password: "student-pass-1" }));

    const { LoginCode } = await import("@/models/LoginCode");
    const codes = await LoginCode.find({ email: "student@college.edu" }).lean();
    if (!codes[0]) throw new Error("no login code was written");

    // The stored value is a hash, so brute-force the six digits to get the plaintext.
    const { createHash } = await import("node:crypto");
    let plain: string | null = null;
    for (let i = 0; i < 1_000_000; i++) {
      const candidate = String(i).padStart(6, "0");
      if (createHash("sha256").update(candidate).digest("hex") === codes[0].codeHash) { plain = candidate; break; }
    }
    if (!plain) throw new Error("could not recover the code");

    await step("verify code -> session", () => call("POST", "/api/auth/verify", { email: "student@college.edu", code: plain }));
    await step("progress is stored per account", () => call("GET", "/api/progress"));
    await step("me (before onboarding)", () => call("GET", "/api/auth/me"));
    await step("save onboarding", () => call("POST", "/api/onboarding", { year: 2, branch: "Mechanical", comfortLevel: 3, goal: "Understand it properly" }));

    const note = (await step("get note", () => call("GET", `/api/notes/${noteId}`))) as { concepts: unknown[] };
    console.log(`      note has ${note.concepts.length} concepts`);

    const session = (await step("start q&a session", () => call("POST", "/api/qna/sessions", { noteId }))) as { id: string };

    for (const q of [
      "Why does g not depend on the mass of the falling object?",
      "I still don't get the difference between mass and weight.",
      "How do you work out orbital velocity?",
    ]) {
      const turn = (await step(`ask: ${q.slice(0, 18)}...`, () => call("POST", `/api/qna/sessions/${session.id}/turns`, { question: q }))) as {
        concepts: string[]; citations: unknown[];
      };
      console.log(`      tagged ${JSON.stringify(turn.concepts)}, ${turn.citations.length} citations`);
    }

    const ready = (await step("readiness", () => call("GET", `/api/qna/sessions/${session.id}/readiness`))) as { ready: boolean; coveredConcepts: string[] };
    console.log(`      ready=${ready.ready}, covered ${ready.coveredConcepts.length}`);

    const quiz = (await step("generate quiz", () => call("POST", "/api/quizzes", { sessionId: session.id }))) as {
      id: string; questions: Array<{ id: string; options: string[]; conceptSlug: string }>;
    };
    console.log(`      ${quiz.questions.length} questions across ${new Set(quiz.questions.map((q) => q.conceptSlug)).size} concepts`);

    // The answer key must not be in the response.
    const leaked = JSON.stringify(quiz).match(/correctIndex|explanation/);
    if (leaked) throw new Error(`SECURITY: answer key leaked to the client (${leaked[0]})`);
    console.log("      answer key absent from the payload");

    const attempt = (await step("submit attempt", () =>
      call("POST", `/api/quizzes/${quiz.id}/attempts`, {
        answers: quiz.questions.map((q) => ({ questionId: q.id, chosenIndex: 0, msSpent: 4000 })),
      }))) as { resultId: string };

    const result = (await step("get result + feedback", () => call("GET", `/api/results/${attempt.resultId}`))) as {
      score: number; band: string; perConcept: unknown[]; feedbackMd: string | null;
    };
    console.log(`      score=${result.score}% band=${result.band} concepts=${result.perConcept.length} feedback=${result.feedbackMd ? "yes" : "no"}`);

    await step("email result (dry run)", () => call("POST", `/api/results/${attempt.resultId}/email`));

    console.log("\nALL STEPS PASSED\n");
  } finally {
    server.close();
    await mongoose.disconnect().catch(() => {});
    await replset.stop();
  }
}

main().catch((err) => {
  console.error("\nE2E FAILED:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
