import { Router } from "express";
import { credentialsRequest, verifyCodeRequest } from "@study-loop/shared";
import { logout, me, postLogin, postRegister, verifyCode } from "@/controllers/auth.controller";
import { requireUser } from "@/middleware/auth";
import { rateLimit } from "@/middleware/rate-limit";
import { validateBody } from "@/middleware/validate";

export const authRouter: Router = Router();

/**
 * Two factors, in order: the password proves who you claim to be, the emailed
 * code proves you hold the address. Neither endpoint below issues a session --
 * only /verify does.
 *
 * Both send mail on success, so both are rate limited: otherwise the pair is a
 * way to make the app send messages on someone else's behalf.
 */
authRouter.post("/register", rateLimit("auth-register", 5, "15 m"), validateBody(credentialsRequest), postRegister);
authRouter.post("/login", rateLimit("auth-login", 10, "15 m"), validateBody(credentialsRequest), postLogin);

authRouter.post("/verify", rateLimit("auth-verify", 10, "15 m"), validateBody(verifyCodeRequest), verifyCode);
authRouter.post("/logout", logout);
authRouter.get("/me", requireUser, me);
