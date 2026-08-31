// Must come first: config/env validates at import time, so the file has to be
// loaded before any module that reads it. Scripts did this already; the server
// itself did not, which meant `npm run dev` booted with an empty environment.
import "dotenv/config";

import mongoose from "mongoose";
import { createApp } from "@/app";
import { env } from "@/config/env";
import { connectDB } from "@/db/connection";
import { logger } from "@/utils/logger";

/**
 * A rejected promise nobody caught leaves the process in an unknown state.
 * Logging and exiting lets the platform restart a clean instance, which is
 * safer than serving requests from a process that may be half broken.
 */
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "unhandled promise rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});

async function main() {
  // Connect before listening so a bad MONGODB_URI fails the boot rather than
  // the first request that happens to need the database.
  await connectDB();
  logger.info({ db: env.MONGODB_DB }, "mongo connected");

  const server = createApp().listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  // Render sends SIGTERM on deploy; finish in-flight requests before exiting so
  // a student mid-quiz does not get a dropped connection.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info({ signal }, "shutting down");
      server.close(() => {
        void mongoose.disconnect().finally(() => process.exit(0));
      });
      // Do not hang forever on a stuck connection.
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

main().catch((err) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});
