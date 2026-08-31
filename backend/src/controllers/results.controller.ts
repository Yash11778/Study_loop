import type { Request, Response } from "express";
import { emailResult, getResult, retryFailedDeliveries } from "@/services/result.service";
import { asyncHandler } from "@/utils/async-handler";
import { param, userId } from "@/utils/http";

export const getResultById = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getResult(param(req, "id"), userId(req)));
});

export const postResultEmail = asyncHandler(async (req: Request, res: Response) => {
  res.json(await emailResult(param(req, "id"), userId(req)));
});

export const postRetryDeliveries = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await retryFailedDeliveries());
});
