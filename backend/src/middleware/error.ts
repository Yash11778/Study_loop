import type { NextFunction, Request, Response } from "express";
import { AppError } from "@/utils/errors";
import { logger } from "@/utils/logger";
import { isProd } from "@/config/env";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "not_found", message: `No route for ${req.method} ${req.path}` } });
}

/**
 * Deliberate failures (AppError) are surfaced to the client as-is. Anything
 * else is a bug: log it with the stack, tell the client nothing useful.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, "app error");
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }

  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "Something broke on our side. Try again in a moment.",
      ...(isProd ? {} : { details: err instanceof Error ? err.stack : String(err) }),
    },
  });
}
