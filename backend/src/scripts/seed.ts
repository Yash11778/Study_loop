/**
 * Seeds the corpus the app is built against.
 *
 *   npm run seed          -- create any topic that is not already there
 *   npm run seed:reset    -- delete and regenerate every topic
 *
 * Run this before anything else; every later stage assumes notes with concepts
 * exist. It makes real provider calls and paces itself against their per-minute
 * token budgets, so it takes a few minutes.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "@/db/connection";
import { seedAll } from "@/services/seed.service";
import { logger } from "@/utils/logger";

async function main() {
  await connectDB();

  const { seeded, failed } = await seedAll(process.argv.includes("--reset"));

  logger.info({ seeded, failed: failed.map((f) => f.topic) }, "seed complete");

  // A partial corpus still runs, but the operator should know it is partial.
  if (failed.length) {
    for (const f of failed) logger.error({ topic: f.topic }, f.error);
    process.exitCode = 1;
  }
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (err) => {
    logger.error({ err }, "seed failed");
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
