/**
 * Checks every external dependency independently and reports which are usable.
 *
 *   npm run doctor --workspace=backend
 *
 * Run this first when something is broken: it separates "my code is wrong" from
 * "that credential is wrong", which are very different afternoons.
 */
import "dotenv/config";
import mongoose from "mongoose";

type Check = { name: string; ok: boolean; detail: string };

const results: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

async function checkMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return record("MongoDB", false, "MONGODB_URI is not set");

  try {
    await mongoose.connect(uri, { dbName: process.env.MONGODB_DB ?? "study_loop", serverSelectionTimeoutMS: 8000 });

    const admin = mongoose.connection.db?.admin();
    const info = await admin?.command({ hello: 1 });
    // Transactions and Atlas Vector Search both need a replica set.
    const isReplicaSet = Boolean(info?.setName);

    record(
      "MongoDB",
      true,
      isReplicaSet
        ? `connected to replica set "${info?.setName}"`
        : "connected, but NOT a replica set -- the seed's transaction will fail"
    );
    await mongoose.disconnect();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(
      "MongoDB",
      false,
      msg.includes("bad auth")
        ? "authentication failed -- check the username/password in MONGODB_URI against Atlas > Database Access"
        : msg.includes("ETIMEOUT") || msg.includes("querySrv")
          ? "cannot reach the cluster -- check the hostname and Atlas > Network Access allowlist"
          : msg
    );
  }
}

async function checkGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) return record("Groq", false, "GROQ_API_KEY is not set");

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) return record("Groq", false, `HTTP ${res.status} -- ${(await res.text()).slice(0, 140)}`);

    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const ids = body.data?.map((m) => m.id) ?? [];
    const { MODELS } = await import("@/config/ai");
    const configured = MODELS.groq.fast;

    record(
      "Groq",
      ids.includes(configured),
      ids.includes(configured)
        ? `"${configured}" is available (${ids.length} models total)`
        : `"${configured}" is NOT in this account's model list -- update MODELS.groq.fast in config/ai.ts. Available: ${ids.slice(0, 6).join(", ")}`
    );
  } catch (err) {
    record("Groq", false, err instanceof Error ? err.message : String(err));
  }
}

async function checkGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return record("Gemini", false, "GEMINI_API_KEY is not set");

  const { MODELS, EMBEDDING_DIM } = await import("@/config/ai");

  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": key },
    });
    if (!res.ok) return record("Gemini", false, `HTTP ${res.status} -- ${(await res.text()).slice(0, 140)}`);

    const body = (await res.json()) as { models?: Array<{ name: string }> };
    const names = body.models?.map((m) => m.name.replace(/^models\//, "")) ?? [];

    const hasChat = names.includes(MODELS.gemini.reasoning);
    record(
      "Gemini (chat)",
      hasChat,
      hasChat
        ? `"${MODELS.gemini.reasoning}" is available`
        : `"${MODELS.gemini.reasoning}" not available -- update config/ai.ts. Candidates: ${names.filter((n) => n.includes("flash")).slice(0, 5).join(", ")}`
    );

    // Embeddings are checked by actually calling: the dimension has to match
    // what the Atlas vector index was created with, and only a real call says.
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini.embedding}:embedContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          model: `models/${MODELS.gemini.embedding}`,
          content: { parts: [{ text: "gravitational force" }] },
          // Must mirror what providers.ts sends, or this tests a path
          // production never takes.
          outputDimensionality: EMBEDDING_DIM,
        }),
      }
    );

    if (!embedRes.ok) {
      record("Gemini (embeddings)", false, `HTTP ${embedRes.status} -- ${(await embedRes.text()).slice(0, 140)}`);
    } else {
      const body = (await embedRes.json()) as { embedding?: { values?: number[] } };
      const dim = body.embedding?.values?.length ?? 0;
      record(
        "Gemini (embeddings)",
        dim === EMBEDDING_DIM,
        dim === EMBEDDING_DIM
          ? `"${MODELS.gemini.embedding}" returns ${dim} dimensions, matching EMBEDDING_DIM`
          : `returns ${dim} dimensions but EMBEDDING_DIM is ${EMBEDDING_DIM} -- update config/ai.ts and recreate the Atlas vector index`
      );
    }
  } catch (err) {
    record("Gemini", false, err instanceof Error ? err.message : String(err));
  }
}

async function checkResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return record("Resend", false, "RESEND_API_KEY is not set (emails will be logged, not sent)");

  try {
    const res = await fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${key}` } });
    if (res.status === 401) return record("Resend", false, "API key rejected");
    if (!res.ok) return record("Resend", false, `HTTP ${res.status}`);

    const body = (await res.json()) as { data?: Array<{ name: string; status: string }> };
    const verified = body.data?.filter((d) => d.status === "verified") ?? [];

    record(
      "Resend",
      true,
      verified.length > 0
        ? `key valid; verified domains: ${verified.map((d) => d.name).join(", ")}`
        : "key valid, but no verified domain -- onboarding@resend.dev only delivers to your own Resend account address"
    );
  } catch (err) {
    record("Resend", false, err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  await Promise.all([checkMongo(), checkGroq(), checkGemini(), checkResend()]);

  const pad = Math.max(...results.map((r) => r.name.length));
  console.log("");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }
  console.log("");

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`${failed.length} of ${results.length} checks failed.\n`);
    process.exit(1);
  }
  console.log(`All ${results.length} checks passed.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
