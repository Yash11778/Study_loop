/**
 * Every deliberate failure in the app is an AppError, so the error middleware
 * can tell "the user asked for something impossible" (surface it) from "we
 * broke" (log it, return a generic 500).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Sign in to continue.") => new AppError(401, "unauthorized", msg);
export const forbidden = (msg = "You do not have access to this.") => new AppError(403, "forbidden", msg);
export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (msg: string) => new AppError(409, "conflict", msg);
export const tooManyRequests = (msg = "Too many requests. Try again shortly.") =>
  new AppError(429, "rate_limited", msg);
