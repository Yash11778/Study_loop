import { z } from "zod";

/**
 * Fail at boot, not at the first request. Anything optional here degrades to a
 * documented no-op rather than throwing from deep inside a handler.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  /** Comma-separated list of origins the browser app is served from. */
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().default("study_loop"),

  /** Signs session cookies. openssl rand -base64 32 */
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  /** Where the browser app lives; used for links inside emails. */
  APP_URL: z.string().url().default("http://localhost:3000"),

  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("Study Loop <onboarding@resend.dev>"),

  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  CRON_SECRET: z.string().optional(),
});

/**
 * Treat an empty variable as absent.
 *
 * Hosting dashboards store a field you left blank as "", not as nothing -- and
 * Zod's .default() only fires on undefined, so an empty APP_URL skipped its
 * default and then failed .url(), taking the whole boot down over a setting the
 * operator had deliberately left for later.
 */
const withoutEmpty = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== "")
);

const parsed = schema.safeParse(withoutEmpty);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid environment.\n${issues.join("\n")}\n\nCopy .env.example to .env and fill it in.`);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
export const isProd = env.NODE_ENV === "production";
