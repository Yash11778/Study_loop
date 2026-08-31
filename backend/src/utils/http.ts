import type { Request } from "express";
import type { Types } from "mongoose";
import { badRequest, unauthorized } from "./errors";

/** Narrows req.user, which is optional until requireUser has run. */
export function userId(req: Request): Types.ObjectId {
  if (!req.user) throw unauthorized();
  return req.user._id;
}

/**
 * Express 5 types params as string | string[], because a wildcard segment can
 * repeat. None of ours do, so take the first value and reject anything else.
 */
export function param(req: Request, name: string): string {
  const raw = req.params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw badRequest(`Missing ${name}.`);
  return value;
}
