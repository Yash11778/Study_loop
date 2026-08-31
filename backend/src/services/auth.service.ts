import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { env, isProd } from "@/config/env";
import { LoginCode } from "@/models/LoginCode";
import { User } from "@/models/User";
import { sendLoginCode } from "./email.service";
import { AppError, badRequest, conflict, unauthorized } from "@/utils/errors";
import { logger } from "@/utils/logger";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SESSION_TTL = "30d";

const secret = new TextEncoder().encode(env.JWT_SECRET);

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * scrypt rather than bcrypt or argon2: it is memory-hard, it is in Node's
 * standard library, and it needs no native module -- which matters because a
 * native build is one more thing to go wrong on a deploy host.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;

  const derived = await scrypt(password, salt, KEY_LENGTH);
  const expected = Buffer.from(key, "hex");

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Constant-time compare so a wrong code cannot be narrowed by timing. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Issues a code and mails it. Any previous unconsumed code for the address is
 * dropped first, so a resend invalidates the old one rather than leaving two
 * valid codes in flight.
 */
export type RequestCodeOutcome = {
  /** Whether the provider accepted the message. */
  delivered: boolean;
  /**
   * The plaintext code, returned ONLY outside production and ONLY when delivery
   * failed. It lets a local setup with no verified sending domain sign in with
   * any address. Never populated when NODE_ENV is production -- that would make
   * the endpoint an unauthenticated account-takeover.
   */
  devCode?: string;
};

export async function issueCode(rawEmail: string): Promise<RequestCodeOutcome> {
  const email = rawEmail.trim().toLowerCase();

  await LoginCode.deleteMany({ email, consumedAt: { $exists: false } });

  // randomInt is drawn from the CSPRNG; Math.random would be guessable.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await LoginCode.create({
    email,
    codeHash: hash(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  // Outside production the code goes to the log as well, so sign-in still works
  // while the sending domain is unverified. Never in production -- the log would
  // then be a list of live credentials.
  if (!isProd) logger.info({ email, code }, "dev sign-in code");

  try {
    await sendLoginCode(email, code);
    return { delivered: true };
  } catch (err) {
    logger.error({ err, email }, "sign-in code could not be delivered");

    // Outside production the code is already in the log above, so an
    // undeliverable address must not block sign-in -- that is the normal state
    // of a local setup with no verified sending domain.
    if (!isProd) {
      logger.warn("continuing anyway: returning the code in the response (development only)");
      return { delivered: false, devCode: code };
    }

    // In production a student who cannot receive the code cannot sign in, and a
    // 500 would tell them nothing actionable. Resend refuses every recipient
    // except the account owner until a sending domain is verified, which is by
    // far the most likely cause.
    throw new AppError(
      502,
      "email_undeliverable",
      "We could not send a code to that address. If this app is still on an unverified " +
        "sending domain, only the owner's address can receive mail."
    );
  }
}

/**
 * Creates an account and sends the verification code. No session is issued
 * here -- the caller must complete the emailed code first, so an unverified
 * address can never reach the app.
 */
/**
 * Marks the address confirmed and hands back the user, for the path where no
 * emailed code is required. Kept separate from verifyLoginCode so the two ways
 * of establishing a session stay visibly distinct.
 */
async function completeWithoutCode(email: string) {
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { lastLoginAt: new Date(), emailVerifiedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!user) throw new AppError(500, "internal_error", "Could not load your account.");
  return user;
}

export async function register(rawEmail: string, password: string) {
  const email = rawEmail.trim().toLowerCase();

  const existing = await User.findOne({ email }).select("+passwordHash emailVerifiedAt");

  if (existing) {
    // An account that never completed verification is not usable by anyone, so
    // re-registering replaces its password rather than being refused -- which
    // would otherwise strand the address forever on a mistyped password.
    if (!existing.emailVerifiedAt) {
      existing.passwordHash = await hashPassword(password);
      await existing.save();
      return env.REQUIRE_EMAIL_CODE
        ? { requiresCode: true as const, ...(await issueCode(email)) }
        : { requiresCode: false as const, user: await completeWithoutCode(email) };
    }
    throw conflict("An account with that email already exists. Sign in instead.");
  }

  await User.create({ email, passwordHash: await hashPassword(password) });

  return env.REQUIRE_EMAIL_CODE
    ? { requiresCode: true as const, ...(await issueCode(email)) }
    : { requiresCode: false as const, user: await completeWithoutCode(email) };
}

/**
 * Checks the password and, only if it is right, sends a code. The password is
 * the first factor and the emailed code the second, so a stolen password alone
 * does not get anyone in.
 */
export async function login(rawEmail: string, password: string) {
  const email = rawEmail.trim().toLowerCase();

  const user = await User.findOne({ email }).select("+passwordHash");

  // Same message whichever half is wrong, so the endpoint cannot be used to
  // enumerate which addresses have accounts.
  const rejected = () => badRequest("That email and password do not match.");

  if (!user) {
    // Spend comparable time on a missing account so response timing does not
    // reveal whether the address exists.
    await hashPassword(password);
    throw rejected();
  }

  if (!(await verifyPassword(password, user.passwordHash))) throw rejected();

  return env.REQUIRE_EMAIL_CODE
    ? { requiresCode: true as const, ...(await issueCode(email)) }
    : { requiresCode: false as const, user: await completeWithoutCode(email) };
}

/**
 * Verifies a code and returns the user. Deliberately gives the same error for
 * wrong, expired and unknown so the endpoint cannot be used to discover which
 * emails are registered.
 */
export async function verifyLoginCode(rawEmail: string, code: string) {
  const email = rawEmail.trim().toLowerCase();

  const record = await LoginCode.findOne({ email, consumedAt: { $exists: false } }).sort({ createdAt: -1 });

  const invalid = () => badRequest("That code is wrong or has expired. Request a new one.");

  if (!record) throw invalid();

  if (record.expiresAt.getTime() < Date.now()) {
    await record.deleteOne();
    throw invalid();
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await record.deleteOne();
    throw new AppError(429, "too_many_attempts", "Too many wrong codes. Request a new one.");
  }

  if (!safeEqual(record.codeHash, hash(code))) {
    record.attempts += 1;
    await record.save();
    throw invalid();
  }

  record.consumedAt = new Date();
  await record.save();

  // No upsert: a code only ever exists because register() or login() created
  // one, and both require the account to exist first. Upserting here would let
  // the verify endpoint mint accounts with no password at all.
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { lastLoginAt: new Date() }, $setOnInsert: { emailVerifiedAt: new Date() } },
    { returnDocument: "after" }
  );

  if (!user) throw invalid();

  // First successful code is what verifies the address.
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
    await user.save();
  }

  return user;
}

export async function issueSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("study-loop")
    .setExpirationTime(SESSION_TTL)
    .sign(secret);
}

export async function readSessionToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: "study-loop" });
    if (!payload.sub) throw new Error("no subject");
    return payload.sub;
  } catch {
    throw unauthorized("Your session has expired. Sign in again.");
  }
}

export const SESSION_COOKIE = "study_loop_session";

/**
 * The frontend on Vercel and the API on Render are different sites, so the
 * session cookie is cross-site: it needs SameSite=None, which browsers only
 * accept together with Secure. Locally both are on localhost, where Secure
 * would stop the cookie being set at all -- hence the split.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? ("none" as const) : ("lax" as const),
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};
