import type { Request, Response } from "express";
import type { OnboardingRequest } from "@study-loop/shared";
import { validated } from "@/middleware/validate";
import { asyncHandler } from "@/utils/async-handler";
import { unauthorized } from "@/utils/errors";

export const saveOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) throw unauthorized();

  const body = validated<OnboardingRequest>(req);

  user.set("profile", { ...body, completedAt: new Date() });
  await user.save();

  res.status(200).json({ ok: true });
});
