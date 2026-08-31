import { z } from "zod";
import { DIFFICULTIES, RESULT_BANDS } from "./domain";

/**
 * The API contract. The backend validates every request body against these and
 * the frontend infers its types from the same objects, so a change to a payload
 * is a type error on both sides rather than a runtime surprise on one.
 */

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "expected a Mongo ObjectId");

/* ---------- auth ---------- */

/**
 * Password rules are enforced in one place so the sign-up form and the API
 * cannot disagree about what counts as acceptable.
 */
export const password = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(200, "That is longer than 200 characters.")
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number.");

export const credentialsRequest = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password,
});
export type CredentialsRequest = z.infer<typeof credentialsRequest>;

export const requestCodeRequest = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});
export type RequestCodeRequest = z.infer<typeof requestCodeRequest>;

export const verifyCodeRequest = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  code: z.string().regex(/^\d{6}$/, "The code is six digits."),
});
export type VerifyCodeRequest = z.infer<typeof verifyCodeRequest>;

export const requestCodeResponse = z.object({
  ok: z.literal(true),
  delivered: z.boolean(),
  /** Development only, and only when the provider refused the address. */
  devCode: z.string().optional(),
});
export type RequestCodeResponse = z.infer<typeof requestCodeResponse>;

export const meDto = z.object({
  id: objectId,
  email: z.string(),
  name: z.string().nullable(),
  onboarded: z.boolean(),
  profile: z
    .object({
      year: z.number(),
      branch: z.string(),
      comfortLevel: z.number(),
      goal: z.string(),
    })
    .nullable(),
});
export type MeDto = z.infer<typeof meDto>;

/* ---------- onboarding ---------- */

export const onboardingRequest = z.object({
  year: z.number().int().min(1).max(5),
  branch: z.string().min(1).max(80),
  comfortLevel: z.number().int().min(1).max(5),
  goal: z.string().min(1).max(200),
});
export type OnboardingRequest = z.infer<typeof onboardingRequest>;

/* ---------- notes ---------- */

export const conceptDto = z.object({
  slug: z.string(),
  label: z.string(),
  summary: z.string(),
  chunkOrdinals: z.array(z.number().int()),
});
export type ConceptDto = z.infer<typeof conceptDto>;

export const noteDto = z.object({
  id: objectId,
  subject: z.string(),
  title: z.string(),
  bodyMd: z.string(),
  concepts: z.array(conceptDto),
});
export type NoteDto = z.infer<typeof noteDto>;

/* ---------- q&a ---------- */

export const createSessionRequest = z.object({ noteId: objectId });
export type CreateSessionRequest = z.infer<typeof createSessionRequest>;

export const askRequest = z.object({ question: z.string().min(3).max(500) });
export type AskRequest = z.infer<typeof askRequest>;

export const citationDto = z.object({
  chunkId: objectId,
  ordinal: z.number().int(),
  excerpt: z.string(),
});
export type CitationDto = z.infer<typeof citationDto>;

export const turnDto = z.object({
  id: objectId,
  question: z.string(),
  answer: z.string(),
  citations: z.array(citationDto),
  concepts: z.array(z.string()),
});
export type TurnDto = z.infer<typeof turnDto>;

/** Drives the coverage meter and gates the "start quiz" button. */
export const readinessDto = z.object({
  turnCount: z.number().int(),
  coveredConcepts: z.array(z.string()),
  totalConcepts: z.number().int(),
  ready: z.boolean(),
});
export type ReadinessDto = z.infer<typeof readinessDto>;

/* ---------- quiz ---------- */

export const createQuizRequest = z.object({ sessionId: objectId });
export type CreateQuizRequest = z.infer<typeof createQuizRequest>;

/** Note the absence of correctIndex -- this is the shape a browser is allowed to see. */
export const quizQuestionDto = z.object({
  id: objectId,
  conceptSlug: z.string(),
  stem: z.string(),
  options: z.array(z.string()).length(4),
  difficulty: z.enum(DIFFICULTIES),
});
export type QuizQuestionDto = z.infer<typeof quizQuestionDto>;

export const quizDto = z.object({
  id: objectId,
  status: z.enum(["generating", "ready", "failed"]),
  questions: z.array(quizQuestionDto),
});
export type QuizDto = z.infer<typeof quizDto>;

export const submitAttemptRequest = z.object({
  answers: z
    .array(
      z.object({
        questionId: objectId,
        chosenIndex: z.number().int().min(0).max(3),
        msSpent: z.number().int().nonnegative().optional(),
      })
    )
    .min(1),
});
export type SubmitAttemptRequest = z.infer<typeof submitAttemptRequest>;

/* ---------- result ---------- */

export const perConceptDto = z.object({
  conceptSlug: z.string(),
  label: z.string(),
  asked: z.number().int(),
  correct: z.number().int(),
  mastery: z.number().min(0).max(1),
});
export type PerConceptDto = z.infer<typeof perConceptDto>;

export const resultDto = z.object({
  id: objectId,
  score: z.number(),
  band: z.enum(RESULT_BANDS),
  perConcept: z.array(perConceptDto),
  feedbackMd: z.string().nullable(),
  emailStatus: z.enum(["pending", "sent", "delivered", "bounced", "failed"]).nullable(),
});
export type ResultDto = z.infer<typeof resultDto>;

/* ---------- progress ---------- */

/** One row per topic: what this student has done, and how it went. */
export const topicProgressDto = z.object({
  noteId: objectId,
  subject: z.string(),
  title: z.string(),
  questionsAsked: z.number().int(),
  conceptsCovered: z.number().int(),
  totalConcepts: z.number().int(),
  quizzesTaken: z.number().int(),
  bestScore: z.number().nullable(),
  lastScore: z.number().nullable(),
  lastResultId: objectId.nullable(),
  lastActiveAt: z.string().nullable(),
});
export type TopicProgressDto = z.infer<typeof topicProgressDto>;

export const progressDto = z.object({
  topics: z.array(topicProgressDto),
});
export type ProgressDto = z.infer<typeof progressDto>;

/* ---------- errors ---------- */

export const apiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;
