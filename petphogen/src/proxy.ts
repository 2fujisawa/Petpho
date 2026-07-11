import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "petpho-session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow the login page and auth API through
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const session = req.cookies.get(SESSION_COOKIE);
  const isValid =
    session?.value &&
    process.env.ADMIN_PASSWORD &&
    session.value === process.env.ADMIN_PASSWORD;

  if (!isValid) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png).*)"],
};
