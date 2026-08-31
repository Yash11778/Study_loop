import pino from "pino";
import { isProd } from "@/config/env";

export const logger = pino({
  level: isProd ? "info" : "debug",
  ...(isProd ? {} : { transport: { target: "pino-pretty", options: { colorize: true } } }),
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.apiKey", "*.embedding"],
    remove: true,
  },
});
