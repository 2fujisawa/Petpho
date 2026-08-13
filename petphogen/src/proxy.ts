import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken, safeEqual } from "@/lib/session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow the login page and auth API through
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const session = req.cookies.get(SESSION_COOKIE)?.value;
  const password = process.env.ADMIN_PASSWORD;
  const isValid =
    !!session && !!password && safeEqual(session, await sessionToken(password));

  if (!isValid) {
    // API routes get a clean 401 rather than an HTML login page, which a fetch
    // would otherwise try to parse as JSON and fail on confusingly.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png).*)"],
};
