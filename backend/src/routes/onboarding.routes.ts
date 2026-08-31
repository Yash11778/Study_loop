import { Router } from "express";
import { onboardingRequest } from "@study-loop/shared";
import { saveOnboarding } from "@/controllers/onboarding.controller";
import { requireUser } from "@/middleware/auth";
import { validateBody } from "@/middleware/validate";

export const onboardingRouter: Router = Router();

onboardingRouter.post("/", requireUser, validateBody(onboardingRequest), saveOnboarding);
