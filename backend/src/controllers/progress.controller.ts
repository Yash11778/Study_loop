import type { Request, Response } from "express";
import { getProgress } from "@/services/progress.service";
import { asyncHandler } from "@/utils/async-handler";
import { userId } from "@/utils/http";

export const getMyProgress = asyncHandler(async (req: Request, res: Response) => {
  res.json({ topics: await getProgress(userId(req)) });
});
