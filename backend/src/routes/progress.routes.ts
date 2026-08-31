import { Router } from "express";
import { getMyProgress } from "@/controllers/progress.controller";
import { requireUser } from "@/middleware/auth";

export const progressRouter: Router = Router();

progressRouter.get("/", requireUser, getMyProgress);
