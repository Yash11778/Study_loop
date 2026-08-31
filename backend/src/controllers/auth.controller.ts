import type { Request, Response } from "express";
import type { CredentialsRequest, MeDto, VerifyCodeRequest } from "@study-loop/shared";
import { validated } from "@/middleware/validate";
import {
  SESSION_COOKIE,
  issueSessionToken,
  login,
  register,
  sessionCookieOptions,
  verifyLoginCode,
} from "@/services/auth.service";
import { asyncHandler } from "@/utils/async-handler";
import { unauthorized } from "@/utils/errors";

/**
 * Establishes the session when no emailed code is required, or reports that one
 * was sent when it is. Both paths verify the password first.
 */
async function finish(
  res: Response,
  outcome:
    | { requiresCode: true; delivered: boolean; devCode?: string }
    | { requiresCode: false; user: { _id: unknown; profile?: { completedAt?: Date | null } | null } },
  status: number
) {
  if (outcome.requiresCode) {
    return res.status(status).json({
      ok: true,
      requiresCode: true,
      delivered: outcome.delivered,
      // Development only, and only when the provider refused the address.
      ...(outcome.devCode ? { devCode: outcome.devCode } : {}),
    });
  }

  const token = await issueSessionToken(String(outcome.user._id));
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions);

  return res.status(status).json({
    ok: true,
    requiresCode: false,
    token,
    onboarded: Boolean(outcome.user.profile?.completedAt),
  });
}

/** Creates the account. Issues the session unless a code is required first. */
export const postRegister = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = validated<CredentialsRequest>(req);
  await finish(res, await register(email, password), 201);
});

/** Checks the password. Issues the session unless a code is required first. */
export const postLogin = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = validated<CredentialsRequest>(req);
  await finish(res, await login(email, password), 200);
});

/**
 * Exchanges a valid emailed code for a session. Only reachable when
 * REQUIRE_EMAIL_CODE is on; the route stays mounted either way so turning the
 * flag back on needs no redeploy of the frontend.
 */
export const verifyCode = asyncHandler(async (req: Request, res: Response) => {
  const { email, code } = validated<VerifyCodeRequest>(req);

  const user = await verifyLoginCode(email, code);
  const token = await issueSessionToken(String(user._id));

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions);

  // Also returned in the body so a Next server component can hold it; the
  // cookie alone is not readable cross-site.
  res.json({ token, onboarded: Boolean(user.profile?.completedAt) });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) throw unauthorized();

  const p = user.profile;

  const dto: MeDto = {
    id: String(user._id),
    email: user.email,
    name: user.name ?? null,
    onboarded: Boolean(p?.completedAt),
    profile:
      p?.completedAt && p.year != null && p.branch != null && p.comfortLevel != null && p.goal != null
        ? { year: p.year, branch: p.branch, comfortLevel: p.comfortLevel, goal: p.goal }
        : null,
  };

  res.json(dto);
});
