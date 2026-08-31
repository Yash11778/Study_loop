import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { badRequest } from "@/utils/errors";

/**
 * Bodies are validated against the schemas in @study-loop/shared -- the same
 * objects the frontend derives its types from, so the two cannot drift.
 */
export const validateBody =
  <T>(schema: ZodType<T>) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        badRequest(
          "That request was not in the expected shape.",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
        )
      );
    }
    req.valid = parsed.data;
    next();
  };

/** Typed accessor so controllers do not cast req.valid themselves. */
export const validated = <T>(req: Request): T => req.valid as T;
