"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { MeDto } from "@study-loop/shared";
import { ApiRequestError } from "./api-client";
import { api } from "./api";

type SessionState = {
  user: MeDto | null;
  loading: boolean;
  refresh: () => Promise<MeDto | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

/**
 * A non-secret marker saying "this browser has signed in at some point".
 *
 * The session itself is the httpOnly cookie and is never readable here. Without
 * this hint the app has to probe /auth/me on every first load, and a signed-out
 * visitor gets a 401 in the network tab and a red console line on the landing
 * page -- an expected response that still reads as a broken app. The marker is
 * not a credential: forging it only causes a probe that returns 401 anyway.
 */
const SESSION_HINT = "study-loop.signed-in";

const readHint = (): boolean => {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    // Private mode and blocked storage both throw; fall back to probing.
    return true;
  }
};

export const setSessionHint = (value: boolean) => {
  try {
    if (value) localStorage.setItem(SESSION_HINT, "1");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    // Nothing to do -- the cookie still governs the actual session.
  }
};

/**
 * The session lives in the httpOnly cookie the API set, which JavaScript cannot
 * read -- so "am I signed in?" is answered by calling /auth/me once on mount
 * rather than by inspecting storage. A 401 is the signed-out answer, not an
 * error worth surfacing.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
      setSessionHint(true);
      return me;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        // The cookie expired or was cleared; stop claiming we have one.
        setUser(null);
        setSessionHint(false);
        return null;
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setSessionHint(false);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!readHint()) {
      setLoading(false);
      return;
    }
    void refresh().catch(() => setLoading(false));
  }, [refresh]);

  const value = useMemo(() => ({ user, loading, refresh, signOut }), [user, loading, refresh, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
