import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a nonce.
 *
 * Next injects its own inline bootstrap scripts, so a CSP without a nonce would
 * either block the app or need 'unsafe-inline' -- which defeats the point. Next
 * reads the nonce out of this header and stamps it onto the scripts it emits.
 *
 * 'strict-dynamic' lets those nonced scripts load the rest of the bundle without
 * having to enumerate every chunk URL.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const isDev = process.env.NODE_ENV !== "production";
  // Read at runtime, not inlined at build time. If this is unset in the
  // deployment environment, connect-src collapses to 'self' and the browser
  // silently blocks every API call -- so it must be set on Vercel, not only in
  // the build. See the deployment table in the README.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

  const csp = [
    `default-src 'self'`,
    // unsafe-eval is required by the dev-mode React refresh runtime only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ""}`,
    // Next inlines critical CSS, and Google Fonts serves a stylesheet.
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob:`,
    // The API lives on another origin, so it must be named explicitly.
    `connect-src 'self' ${apiUrl} ${isDev ? "ws: http://localhost:*" : ""}`.trim(),
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ]
    .filter(Boolean)
    .join("; ")
    .replace(/\s{2,}/g, " ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers } });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  if (!isDev) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  return response;
}

export const config = {
  // Static assets are served with their own immutable caching and need no CSP
  // work; excluding them keeps the middleware off the hot path.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
