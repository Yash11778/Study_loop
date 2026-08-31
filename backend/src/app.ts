import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { corsOrigins } from "@/config/env";
import { errorHandler, notFoundHandler } from "@/middleware/error";
import { apiRouter } from "@/routes";
import { logger } from "@/utils/logger";

export function createApp() {
  const app = express();

  // Behind Render's proxy the client IP arrives in X-Forwarded-For; without
  // this the rate limiter buckets every request under the proxy's address.
  app.set("trust proxy", 1);

  app.use(helmet());

  // credentials:true is required for the session cookie to survive the
  // Vercel -> Render cross-origin hop, and it forbids a wildcard origin, so
  // CORS_ORIGINS must list the frontend URL explicitly in production.
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header means a same-origin or non-browser caller (health
        // checks, curl), which CORS does not govern.
        if (!origin || corsOrigins.includes(origin)) return callback(null, true);
        // Refuse by omitting the header rather than throwing: a thrown error
        // here becomes a 500, which reads as "the API is broken" when the real
        // problem is a misconfigured CORS_ORIGINS.
        logger.warn({ origin }, "blocked a cross-origin request from an unlisted origin");
        callback(null, false);
      },
      credentials: true,
    })
  );

  // Correlates every log line for one request, and gives support something to
  // ask for when a student reports a failure.
  app.use((req, res, next) => {
    const id = req.get("x-request-id") ?? randomUUID();
    res.setHeader("x-request-id", id);
    next();
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
