import { Router } from "express";
import { askRequest, createSessionRequest } from "@study-loop/shared";
import { getReadiness, getTurns, postSession, postTurn } from "@/controllers/qna.controller";
import { requireUser } from "@/middleware/auth";
import { rateLimit } from "@/middleware/rate-limit";
import { validateBody } from "@/middleware/validate";

export const qnaRouter: Router = Router();

qnaRouter.post("/sessions", requireUser, validateBody(createSessionRequest), postSession);
qnaRouter.get("/sessions/:id/turns", requireUser, getTurns);
qnaRouter.get("/sessions/:id/readiness", requireUser, getReadiness);

// The endpoint that spends inference quota per question asked.
qnaRouter.post(
  "/sessions/:id/turns",
  requireUser,
  rateLimit("qna-turn", 20, "5 m"),
  validateBody(askRequest),
  postTurn
);
