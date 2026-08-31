/**
 * Next inlines NEXT_PUBLIC_* at build time, but only where it appears as a full
 * static property path -- so it cannot be read through a dynamic key.
 */

/**
 * Resolved on access rather than at import.
 *
 * This used to validate at module scope, which runs while Next prerenders the
 * landing page: a missing variable took down the whole build with a stack trace
 * pointing at env.ts, rather than telling anyone which setting was absent and
 * where to put it. Deferring to first use keeps the build honest -- pages that
 * never call the API still render -- and turns the failure into a message the
 * person configuring the deploy can act on.
 */
export const clientEnv = {
  get apiUrl(): string {
    const value = process.env.NEXT_PUBLIC_API_URL;

    if (!value) {
      throw new Error(
        "NEXT_PUBLIC_API_URL is not set. Locally: copy frontend/.env.example to " +
          ".env.local and fill it in. On Vercel: add it under Settings > " +
          "Environment Variables and redeploy -- it is read at build time, so a " +
          "value added afterwards does not apply until the next build."
      );
    }

    // A trailing slash produces "//api/..." in every request path.
    return value.replace(/\/+$/, "");
  },
};
