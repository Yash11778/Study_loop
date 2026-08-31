import type { HydratedDocument } from "mongoose";
import type { UserDoc } from "@/models/User";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireUser -- the application user behind the Clerk session. */
      user?: HydratedDocument<UserDoc>;
      /** Set by validateBody() -- the parsed, trusted body. */
      valid?: unknown;
    }
  }
}

export {};
