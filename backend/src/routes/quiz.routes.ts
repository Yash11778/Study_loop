import { Router } from "express";
import { createQuizRequest, submitAttemptRequest } from "@study-loop/shared";
import { getQuizById, postAttempt, postQuiz } from "@/controllers/quiz.controller";
import { requireUser } from "@/middleware/auth";
import { rateLimit } from "@/middleware/rate-limit";
import { validateBody } from "@/middleware/validate";

export const quizRouter: Router = Router();

// Generation is the most expensive call in the app -- ten validated questions
// over the whole note.
quizRouter.post(
  "/",
  requireUser,
  rateLimit("quiz-generate", 5, "10 m"),
  validateBody(createQuizRequest),
  postQuiz
);
quizRouter.get("/:id", requireUser, getQuizById);
quizRouter.post("/:id/attempts", requireUser, validateBody(submitAttemptRequest), postAttempt);
