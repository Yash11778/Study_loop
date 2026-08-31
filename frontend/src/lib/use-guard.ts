"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "./session";

/**
 * Client-side route guard. The session cookie belongs to the API's origin, so
 * Next's server side cannot read it -- the guard has to run in the browser once
 * /auth/me has answered.
 */
export function useGuard(options: { requireOnboarded?: boolean } = {}) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/");
    else if (options.requireOnboarded && !user.onboarded) router.replace("/onboarding");
  }, [loading, user, options.requireOnboarded, router]);

  return { user, loading };
}
