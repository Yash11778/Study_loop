import { apiError, type ApiError } from "@study-loop/shared";
import { clientEnv } from "./env";

/**
 * The single door to the backend. Nothing calls fetch() directly, so auth
 * headers, error shaping and the base URL are decided in one place.
 */

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Clerk token. Server components must pass it; the browser sends the cookie. */
  token?: string;
  signal?: AbortSignal;
};

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;

  const res = await fetch(`${clientEnv.apiUrl}${path}`, {
    method,
    signal,
    credentials: "include",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    // The backend always shapes errors the same way, but a proxy or a crash can
    // still return HTML -- fall back rather than throwing a parse error over it.
    let parsed: ApiError | null = null;
    try {
      parsed = apiError.parse(await res.json());
    } catch {
      parsed = null;
    }

    throw new ApiRequestError(
      res.status,
      parsed?.error.code ?? "unknown",
      parsed?.error.message ?? `Request failed with ${res.status}.`,
      parsed?.error.details
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
