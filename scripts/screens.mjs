/**
 * Drives the whole journey and captures every screen at desktop and mobile
 * widths, so the layout can be reviewed rather than assumed.
 *
 *   node scripts/screens.mjs
 *
 * Writes to screenshots/. Also reports console errors and failed requests, so a
 * visual pass doubles as a functional one.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../backend/.env", import.meta.url).pathname, quiet: true });

const EMAIL = "screens@studyloop.test";
const PASSWORD = "screens-me-1234";
const API = "http://localhost:4000";
const WEB = "http://localhost:3000";
const OUT = new URL("../screenshots/", import.meta.url).pathname;

const DESKTOP = { width: 1280, height: 860 };
const MOBILE = { width: 390, height: 844 }; // iPhone 14

const procs = [];
function start(name, args) {
  const p = spawn("npm", args, { cwd: new URL("..", import.meta.url).pathname, env: process.env, detached: true });
  procs.push(p);
  return p;
}
function stopServers() {
  for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch {} }
}
process.on("exit", stopServers);

async function waitFor(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await sleep(1000);
  }
  throw new Error(`${label} did not come up`);
}

const problems = [];

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  console.log("starting servers...");
  start("api", ["run", "dev:backend"]);
  start("web", ["run", "dev:frontend"]);
  await waitFor(`${API}/api/health`, "backend");
  await waitFor(WEB, "frontend");
  console.log("both up\n");

  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB });
  const db = mongoose.connection.db;
  await db.collection("users").deleteMany({ email: EMAIL });
  await db.collection("logincodes").deleteMany({ email: EMAIL });

  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();

  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });

  /** Capture the same state at both widths. */
  const shoot = async (name) => {
    await page.setViewportSize(DESKTOP);
    await sleep(500);
    await page.screenshot({ path: `${OUT}${name}-desktop.png` });
    await page.setViewportSize(MOBILE);
    await sleep(700);
    await page.screenshot({ path: `${OUT}${name}-mobile.png`, fullPage: true });
    await page.setViewportSize(DESKTOP);
    await sleep(400);
    console.log(`  captured ${name}`);
  };

  try {
    await page.goto(WEB, { waitUntil: "networkidle" });
    await shoot("01-signin");

    await page.click("text=Create an account");
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await shoot("02-signup-filled");

    await page.click('button[type="submit"]');
    await page.waitForSelector("text=Check your email", { timeout: 30_000 });
    await shoot("03-code");

    const doc = await db.collection("logincodes").findOne({ email: EMAIL }, { sort: { createdAt: -1 } });
    let code = null;
    for (let i = 0; i < 1_000_000; i++) {
      const c = String(i).padStart(6, "0");
      if (createHash("sha256").update(c).digest("hex") === doc.codeHash) { code = c; break; }
    }
    await page.fill('input[inputmode="numeric"]', code);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/onboarding", { timeout: 30_000 });
    await shoot("04-onboarding");

    for (let i = 0; i < 4; i++) {
      await page.locator("main button").filter({ hasNotText: "Back" }).first().click();
      await sleep(500);
    }
    await page.waitForURL("**/study", { timeout: 30_000 });
    await page.waitForSelector("text=Concepts in this note", { timeout: 60_000 });
    await shoot("05-study-empty");

    try {
      await page.fill('input[placeholder="What don\'t you follow?"]', "What is the difference between mass and weight?");
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-turn]", { timeout: 150_000 });
      await sleep(800);
      await shoot("06-study-answered");
    } catch {
      // A throttled provider should not cost us the screens already captured.
      console.log("  (skipped 06: the answer did not arrive in time)");
    }

    // Two more questions unlock the quiz; pace them for the token budget.
    for (const q of ["Why is g the same for a feather and a hammer?", "How do you work out orbital velocity?"]) {
      await sleep(20_000);
      await page.fill('input[placeholder="What don\'t you follow?"]', q);
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-turn]", { timeout: 150_000 });
      await sleep(600);
    }

    await page.click("text=Start quiz");
    await page.waitForURL("**/quiz/**", { timeout: 150_000 });
    await sleep(1200);
    await shoot("07-quiz");

    for (let i = 0; i < 10; i++) {
      await page.locator('main button:has(span:text-matches("^[A-D]$"))').first().click();
      await sleep(200);
      const next = page.locator('button:has-text("Next question")');
      if (await next.isVisible().catch(() => false)) { await next.click(); await sleep(300); }
    }
    await page.click('button:has-text("Finish and see result")');
    await page.waitForURL("**/results/**", { timeout: 150_000 });
    await page.waitForSelector("text=By concept", { timeout: 90_000 });
    await sleep(1000);
    await shoot("08-result");

    console.log("\nconsole/network problems:", problems.length ? "\n  - " + [...new Set(problems)].join("\n  - ") : "none");
  } finally {
    await browser.close();
    await mongoose.disconnect().catch(() => {});
    stopServers();
  }
}

main().catch((e) => { console.error("FAILED:", e.message); stopServers(); process.exit(1); });
