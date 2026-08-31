import { NextResponse } from "next/server";

/**
 * Vercel Cron calls this hourly; it forwards to the backend's internal retry
 * endpoint. The hop exists because Render's cron jobs are a paid feature while
 * Vercel's are not -- and because CRON_SECRET stays server-side either way.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!secret || !apiUrl) {
    return NextResponse.json({ error: "CRON_SECRET or NEXT_PUBLIC_API_URL is not configured" }, { status: 500 });
  }

  // Vercel signs its cron invocations with this header; reject anything else so
  // the endpoint is not an open trigger.
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${apiUrl}/api/results/internal/retry-deliveries`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
