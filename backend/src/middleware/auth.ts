import type { NextFunction, Request, Response } from "express";
import { connectDB } from "@/db/connection";
import { User } from "@/models/User";
import { SESSION_COOKIE, readSessionToken } from "@/services/auth.service";
import { unauthorized } from "@/utils/errors";
import { asyncHandler } from "@/utils/async-handler";

/**
 * Reads the session cookie, or an Authorization: Bearer header. The header path
 * exists because Next server components cannot forward a cross-site cookie --
 * they read it server-side and pass it explicitly.
 */
function tokenFrom(req: Request): string | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (typeof cookie === "string" && cookie) return cookie;

  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);

  return null;
}

export const requireUser = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = tokenFrom(req);
  if (!token) throw unauthorized();

  const userId = await readSessionToken(token);

  await connectDB();
  const user = await User.findById(userId);
  if (!user) throw unauthorized("That account no longer exists.");

  req.user = user;
  next();
});

/** Guards the internal cron endpoints, which carry no user session. */
export function requireCronSecret(secret: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!secret || req.get("authorization") !== `Bearer ${secret}`) return next(unauthorized());
    next();
  };
}
