import type { Request, Response } from "express";
import type { CreateQuizRequest, SubmitAttemptRequest } from "@study-loop/shared";
import { validated } from "@/middleware/validate";
import { createQuiz, getQuiz } from "@/services/quiz.service";
import { submitAttempt } from "@/services/result.service";
import { asyncHandler } from "@/utils/async-handler";
import { param, userId } from "@/utils/http";

export const postQuiz = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = validated<CreateQuizRequest>(req);
  res.status(201).json(await createQuiz(sessionId, userId(req)));
});

export const getQuizById = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getQuiz(param(req, "id"), userId(req)));
});

export const postAttempt = asyncHandler(async (req: Request, res: Response) => {
  const body = validated<SubmitAttemptRequest>(req);
  res.status(201).json(await submitAttempt(param(req, "id"), userId(req), body));
});
