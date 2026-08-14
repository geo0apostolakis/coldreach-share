import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

// Cron runs without a session; it authenticates with CRON_SECRET instead.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/cron"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  if (await verifyToken(request.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // automatesphere-logo.png is excluded because the login page renders it, and a
  // signed-out visitor would otherwise be redirected mid-request and see it break.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|automatesphere-logo.png).*)"],
};
