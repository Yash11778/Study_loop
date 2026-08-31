import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextFunction, Request, Response } from "express";
import { env, isProd } from "@/config/env";
import { logger } from "@/utils/logger";
import { tooManyRequests } from "@/utils/errors";

const configured = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);

const redis = configured
  ? new Redis({ url: env.UPSTASH_REDIS_REST_URL!, token: env.UPSTASH_REDIS_REST_TOKEN! })
  : null;

if (!configured) {
  logger.warn(
    "Upstash is not configured -- falling back to an in-process rate limiter. " +
      "That is per-instance and resets on deploy, so configure Upstash before scaling past one instance."
  );
}

/**
 * Per-process sliding window, used when Upstash is absent.
 *
 * The limiter previously no-opped in that case, which meant a deployment with
 * one variable missing silently shipped with sign-in and quiz generation
 * completely unmetered. An approximate limit is far better than none; it just
 * cannot be shared across instances.
 */
class MemoryLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly tokens: number, private readonly windowMs: number) {}

  check(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);

    if (recent.length >= this.tokens) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);

    // Bound the map so a stream of unique keys cannot grow it without limit.
    if (this.hits.size > 10_000) {
      for (const [k, times] of this.hits) {
        if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}

const WINDOW_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };

export function rateLimit(name: string, tokens: number, window: `${number} ${"s" | "m" | "h"}`) {
  const [count, unit] = window.split(" ") as [string, "s" | "m" | "h"];
  const windowMs = Number(count) * WINDOW_MS[unit]!;

  const upstash = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(tokens, window),
        prefix: `rl:${name}`,
        analytics: true,
      })
    : null;

  const memory = new MemoryLimiter(tokens, windowMs);

  return async (req: Request, res: Response, next: NextFunction) => {
    // Authenticated requests are limited per account; anonymous ones per IP.
    const key = `${name}:${req.user?.id ?? req.ip ?? "anonymous"}`;

    if (!upstash) {
      if (!memory.check(key)) return next(tooManyRequests());
      return next();
    }

    try {
      const { success, limit, remaining, reset } = await upstash.limit(key);
      res.setHeader("RateLimit-Limit", limit);
      res.setHeader("RateLimit-Remaining", remaining);
      res.setHeader("RateLimit-Reset", Math.ceil((reset - Date.now()) / 1000));
      if (!success) return next(tooManyRequests());
      next();
    } catch (err) {
      // A limiter outage must not take the API down -- but it must not silently
      // remove the limit either, so fall through to the in-process one.
      logger.warn({ err }, "upstash unavailable, using in-process limiter");
      if (!memory.check(key)) return next(tooManyRequests());
      next();
    }
  };
}

export const rateLimitingIsDistributed = configured;
export const rateLimitingWarning =
  !configured && isProd
    ? "Running in production without Upstash: rate limits are per-instance only."
    : null;
