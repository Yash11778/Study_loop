import type {
  MeDto,
  ProgressDto,
  CredentialsResponse,
  NoteDto,
  OnboardingRequest,
  QuizDto,
  ReadinessDto,
  ResultDto,
  SubmitAttemptRequest,
  TurnDto,
} from "@study-loop/shared";
import { apiFetch } from "./api-client";

/**
 * Every endpoint the UI can reach, typed from the shared contracts. Changing a
 * payload in shared/ breaks this file at compile time rather than at runtime.
 */
export const api = {
  register: (email: string, password: string) =>
    apiFetch<CredentialsResponse>("/api/auth/register", { method: "POST", body: { email, password } }),

  login: (email: string, password: string) =>
    apiFetch<CredentialsResponse>("/api/auth/login", { method: "POST", body: { email, password } }),

  verifyCode: (email: string, code: string) =>
    apiFetch<{ token: string; onboarded: boolean }>("/api/auth/verify", {
      method: "POST",
      body: { email, code },
    }),

  logout: () => apiFetch<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: (token?: string) => apiFetch<MeDto>("/api/auth/me", { token }),

  progress: (token?: string) => apiFetch<ProgressDto>("/api/progress", { token }),

  listTurns: (sessionId: string, token?: string) =>
    apiFetch<TurnDto[]>(`/api/qna/sessions/${sessionId}/turns`, { token }),

  saveOnboarding: (body: OnboardingRequest, token?: string) =>
    apiFetch<{ ok: true }>("/api/onboarding", { method: "POST", body, token }),

  listNotes: (token?: string) =>
    apiFetch<Array<{ id: string; subject: string; title: string }>>("/api/notes", { token }),

  getNote: (id: string, token?: string) => apiFetch<NoteDto>(`/api/notes/${id}`, { token }),

  startSession: (noteId: string, token?: string) =>
    apiFetch<{ id: string }>("/api/qna/sessions", { method: "POST", body: { noteId }, token }),

  ask: (sessionId: string, question: string, token?: string) =>
    apiFetch<TurnDto>(`/api/qna/sessions/${sessionId}/turns`, {
      method: "POST",
      body: { question },
      token,
    }),

  readiness: (sessionId: string, token?: string) =>
    apiFetch<ReadinessDto>(`/api/qna/sessions/${sessionId}/readiness`, { token }),

  createQuiz: (sessionId: string, token?: string) =>
    apiFetch<QuizDto>("/api/quizzes", { method: "POST", body: { sessionId }, token }),

  getQuiz: (id: string, token?: string) => apiFetch<QuizDto>(`/api/quizzes/${id}`, { token }),

  submitAttempt: (quizId: string, body: SubmitAttemptRequest, token?: string) =>
    apiFetch<{ resultId: string }>(`/api/quizzes/${quizId}/attempts`, { method: "POST", body, token }),

  getResult: (id: string, token?: string) => apiFetch<ResultDto>(`/api/results/${id}`, { token }),

  emailResult: (id: string, token?: string) =>
    apiFetch<{ ok: true }>(`/api/results/${id}/email`, { method: "POST", token }),
};
