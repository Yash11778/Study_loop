import type { Request, Response } from "express";
import type { AskRequest, CreateSessionRequest } from "@study-loop/shared";
import { validated } from "@/middleware/validate";
import { ask, createSession, listTurns, readiness } from "@/services/qna.service";
import { asyncHandler } from "@/utils/async-handler";
import { param, userId } from "@/utils/http";

export const postSession = asyncHandler(async (req: Request, res: Response) => {
  const { noteId } = validated<CreateSessionRequest>(req);
  res.status(201).json(await createSession(userId(req), noteId));
});

export const postTurn = asyncHandler(async (req: Request, res: Response) => {
  const { question } = validated<AskRequest>(req);
  res.json(await ask(param(req, "id"), userId(req), question));
});

export const getTurns = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listTurns(param(req, "id"), userId(req)));
});

export const getReadiness = asyncHandler(async (req: Request, res: Response) => {
  res.json(await readiness(param(req, "id"), userId(req)));
});
