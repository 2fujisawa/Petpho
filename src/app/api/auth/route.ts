import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken, safeEqual } from "@/lib/session";
import { ConfigError, requireEnv } from "@/lib/env";

// Best-effort throttle. Serverless instances are short-lived so this isn't a
// hard guarantee, but it turns an unlimited online guessing loop into a slow
// one, which is the difference that matters for a single shared password.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(req: NextRequest) {
  // A malformed body is a bad request, not a server fault, so guard the parse
  // rather than letting it surface as an unhandled 500.
  let password: unknown;
  try {
    ({ password } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  // A deployment with no password set can never accept a sign-in, so saying
  // "Incorrect password" sends the reader hunting for a typo in something that
  // could never have worked. Say what's actually wrong instead.
  let expected: string;
  try {
    expected = requireEnv("ADMIN_PASSWORD");
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : "Sign-in is not configured";
    console.error("auth:", message);
    return NextResponse.json({ error: message }, { status: 503 });
  }

  if (typeof password !== "string" || !safeEqual(password, expected)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  attempts.delete(ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return res;
}
