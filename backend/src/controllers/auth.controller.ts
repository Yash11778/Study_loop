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
 * Step one of sign-up: create the account, then send a code. No session comes
 * back -- the address has to be proven first.
 */
export const postRegister = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = validated<CredentialsRequest>(req);
  const outcome = await register(email, password);

  res.status(201).json({
    ok: true,
    delivered: outcome.delivered,
    // Development only, and only when the provider refused the address.
    ...(outcome.devCode ? { devCode: outcome.devCode } : {}),
  });
});

/**
 * Step one of sign-in: check the password, then send a code. A correct password
 * on its own still yields no session.
 */
export const postLogin = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = validated<CredentialsRequest>(req);
  const outcome = await login(email, password);

  res.json({
    ok: true,
    delivered: outcome.delivered,
    ...(outcome.devCode ? { devCode: outcome.devCode } : {}),
  });
});

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
