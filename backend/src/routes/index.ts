import { Router } from "express";
import { authRouter } from "./auth.routes";
import { healthRouter } from "./health.routes";
import { onboardingRouter } from "./onboarding.routes";
import { notesRouter } from "./notes.routes";
import { progressRouter } from "./progress.routes";
import { qnaRouter } from "./qna.routes";
import { quizRouter } from "./quiz.routes";
import { resultsRouter } from "./results.routes";

export const apiRouter: Router = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/onboarding", onboardingRouter);
apiRouter.use("/notes", notesRouter);
apiRouter.use("/progress", progressRouter);
apiRouter.use("/qna", qnaRouter);
apiRouter.use("/quizzes", quizRouter);
apiRouter.use("/results", resultsRouter);
