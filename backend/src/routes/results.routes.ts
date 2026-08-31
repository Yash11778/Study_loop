import { Router } from "express";
import { env } from "@/config/env";
import { getResultById, postResultEmail, postRetryDeliveries } from "@/controllers/results.controller";
import { requireCronSecret, requireUser } from "@/middleware/auth";
import { rateLimit } from "@/middleware/rate-limit";

export const resultsRouter: Router = Router();

resultsRouter.get("/:id", requireUser, getResultById);
resultsRouter.post("/:id/email", requireUser, rateLimit("result-email", 5, "10 m"), postResultEmail);

// Internal: no user session, guarded by a shared secret instead.
resultsRouter.post("/internal/retry-deliveries", requireCronSecret(env.CRON_SECRET), postRetryDeliveries);
