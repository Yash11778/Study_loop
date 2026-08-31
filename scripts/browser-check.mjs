/**
 * Drives the entire user journey in a real Chromium and fails on any console
 * error or failed network request.
 *
 *   npm run browser-check
 *
 * Starts both servers itself, so it needs backend/.env filled in and the note
 * already seeded. It makes real Groq/Gemini calls and takes a couple of minutes.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../backend/.env", import.meta.url).pathname, quiet: true });

const EMAIL = `browser-check@studyloop.test`;
const PASSWORD = "check-me-1234";
const API = "http://localhost:4000";
const WEB = "http://localhost:3000";

const procs = [];
function start(name, args) {
  // detached puts each server in its own process group. npm spawns the real
  // server as a grandchild, and signalling only the npm process leaves that
  // grandchild holding the port -- which then breaks every subsequent run.
  const p = spawn("npm", args, {
    cwd: new URL("..", import.meta.url).pathname,
    env: process.env,
    detached: true,
  });
  p.stdout.on("data", (d) => process.env.VERBOSE && console.log(`[${name}] ${d}`));
  p.stderr.on("data", (d) => process.env.VERBOSE && console.log(`[${name}!] ${d}`));
  procs.push(p);
  return p;
}

function stopServers() {
  for (const p of procs) {
    // A negative pid signals the whole process group, so the grandchild that
    // actually holds the port dies too.
    try { process.kill(-p.pid, "SIGTERM"); } catch {}
  }
}

process.on("exit", stopServers);
process.on("SIGINT", () => { stopServers(); process.exit(130); });

async function waitFor(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`${label} did not come up at ${url}`);
}

/** The stored code is a hash, so recover the plaintext by brute force. */
async function recoverCode(db) {
  const doc = await db
    .collection("logincodes")
    .findOne({ email: EMAIL, consumedAt: { $exists: false } }, { sort: { createdAt: -1 } });
  if (!doc) throw new Error("no sign-in code was written");

  for (let i = 0; i < 1_000_000; i++) {
    const candidate = String(i).padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === doc.codeHash) return candidate;
  }
  throw new Error("could not recover the code");
}

const problems = [];
const steps = [];
const step = async (label, fn) => {
  const t = Date.now();
  await fn();
  steps.push(`  ok  ${label.padEnd(34)} ${Date.now() - t}ms`);
};

async function main() {
  console.log("starting servers...");
  start("api", ["run", "dev:backend"]);
  start("web", ["run", "dev:frontend"]);

  await waitFor(`${API}/api/health`, "backend");
  await waitFor(WEB, "frontend");
  console.log("both up\n");

  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB });
  const db = mongoose.connection.db;
  // Start from a clean slate so onboarding actually runs.
  await db.collection("users").deleteMany({ email: EMAIL });
  await db.collection("logincodes").deleteMany({ email: EMAIL });

  // Use the system Chrome rather than Playwright's own download: it is already
  // installed here, and it is closer to what a student will actually use.
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`console.${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    problems.push(`requestfailed: ${req.method()} ${req.url()} -- ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    // 4xx/5xx on any request the app makes is a network-tab error.
    if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.request().method()} ${res.url()}`);
  });

  try {
    await step("load sign-in page", async () => {
      await page.goto(WEB, { waitUntil: "networkidle" });
      await page.waitForSelector("text=Sign in");
    });

    // With REQUIRE_EMAIL_CODE off, the password alone establishes the session,
    // so registration lands straight on onboarding with no code step.
    await step("register (email + password)", async () => {
      await page.click("text=Create an account");
      await page.fill('input[type="email"]', EMAIL);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL("**/onboarding", { timeout: 60_000 });
    });

    await step("session established", async () => {
      const res = await page.request.get(`${API}/api/auth/me`);
      if (res.status() !== 200) throw new Error(`/auth/me returned ${res.status()}, expected a session`);
    });

    await step("onboarding (4 questions)", async () => {
      for (let i = 0; i < 4; i++) {
        await page.locator("main button").filter({ hasNotText: "Back" }).first().click();
        await sleep(400);
      }
      await page.waitForURL("**/study", { timeout: 30_000 });
    });

    await step("study page loads notes", async () => {
      await page.waitForSelector("text=Concepts in this note", { timeout: 60_000 });
    });

    // The topic filter: switching must load a different note and start a fresh
    // session, not carry the previous topic's thread across.
    await step("switch topic via the filter", async () => {
      const chips = page.locator('button[class*="rounded-full"]').filter({ hasNotText: /^$/ });
      const count = await chips.count();
      if (count < 2) throw new Error("expected more than one topic chip");

      const firstHeading = await page.locator("main h1").first().textContent();
      await chips.nth(1).click();
      await page.waitForFunction(
        (prev) => document.querySelector("main h1")?.textContent !== prev,
        firstHeading,
        { timeout: 60_000 }
      );
      await page.waitForSelector("text=Concepts in this note", { timeout: 60_000 });

      // Switch back so the rest of the run works against the first topic.
      await chips.nth(0).click();
      await page.waitForFunction(
        (want) => document.querySelector("main h1")?.textContent === want,
        firstHeading,
        { timeout: 60_000 }
      );
      await sleep(600);
    });

    let expectedTurns = 0;
    for (const q of [
      "Why does g not depend on the mass of the falling object?",
      "I still don't get the difference between mass and weight.",
      "How do you work out orbital velocity?",
    ]) {
      // Groq allows 8000 tokens/minute and each question carries five retrieved
      // passages, so three fired back-to-back exceeds a minute's budget. Real
      // students read the answer before asking again; pace the test the same way
      // rather than measuring a burst nobody produces.
      if (expectedTurns > 0) await sleep(20_000);

      expectedTurns += 1;
      const want = expectedTurns;
      await step(`ask: ${q.slice(0, 20)}...`, async () => {
        await page.fill('input[placeholder="What don\'t you follow?"]', q);
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          (n) => document.querySelectorAll("[data-turn]").length >= n,
          want,
          { timeout: 120_000 }
        );
        await sleep(400);
      });
    }

    await step("generate quiz", async () => {
      await page.click("text=Start quiz");
      await page.waitForURL("**/quiz/**", { timeout: 120_000 });
      await page.waitForSelector("text=Recall,text=Apply,text=Analyse", { timeout: 30_000 }).catch(() => {});
    });

    await step("quiz has the full 10 questions", async () => {
      const count = await page.locator('main button:has(span:text-matches("^[A-D]$"))').count();
      // Four options per question, one question on screen at a time.
      const total = await page.evaluate(() => document.querySelectorAll("[class*=flex-1][class*=rounded-full]").length);
      if (total < 10) throw new Error(`quiz has ${total} questions, expected 10`);
    });

    await step("answer 10 questions", async () => {
      for (let i = 0; i < 10; i++) {
        await page.locator('main button:has(span:text-matches("^[A-D]$"))').first().click();
        await sleep(200);
        const next = page.locator('button:has-text("Next question")');
        if (await next.isVisible().catch(() => false)) {
          await next.click();
          await sleep(300);
        }
      }
    });

    await step("submit and see result", async () => {
      await page.click('button:has-text("Finish and see result")');
      await page.waitForURL("**/results/**", { timeout: 120_000 });
      await page.waitForSelector("text=By concept", { timeout: 60_000 });
    });
  } finally {
    await page.screenshot({ path: "browser-check.png", fullPage: true }).catch(() => {});
    await browser.close();
    await mongoose.disconnect().catch(() => {});
    stopServers();
  }

  console.log(steps.join("\n"));

  // React dev mode warns about things that are real bugs in production too.
  const ignorable = [/Download the React DevTools/i, /Fast Refresh/i];
  const real = problems.filter((p) => !ignorable.some((r) => r.test(p)));

  if (real.length) {
    console.log(`\n${real.length} console/network problem(s):\n`);
    for (const p of [...new Set(real)]) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log("\nNo console errors, no failed requests, no 4xx/5xx.\n");
}

main().catch((err) => {
  console.error("\nBROWSER CHECK FAILED:", err.message);
  if (steps.length) console.log("\ncompleted steps:\n" + steps.join("\n"));
  if (problems.length) {
    console.log("\nconsole/network activity captured before the failure:\n");
    for (const p of [...new Set(problems)]) console.log(`  - ${p}`);
  }
  console.log("");
  stopServers();
  process.exit(1);
});
