import { Router } from "express";
import mongoose from "mongoose";

export const healthRouter: Router = Router();

/** Unauthenticated on purpose -- platform health checks have no session. */
healthRouter.get("/", (_req, res) => {
  // readyState also has a 99 ("uninitialized") case, so this is a lookup, not an array index.
  const states: Record<number, string> = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
    99: "uninitialized",
  };
  const state = states[mongoose.connection.readyState] ?? "unknown";
  res.status(state === "connected" ? 200 : 503).json({ ok: state === "connected", db: state });
});
