import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth gate (Next.js 16 "proxy", formerly middleware). It only checks that a session
 * token exists; pages, Server Actions and route handlers still verify the user against the
 * database (src/server/auth.ts), which is what actually enforces roles and revoked sessions.
 */
const GUEST_PATHS = ["/login", "/forgot-password", "/reset-password"];

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth") ||
    pathname === "/up" ||
    GUEST_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  });

  if (token?.sub && !token.invalid) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/geodata/")) {
    return NextResponse.json({ message: "Unauthenticated." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("redirect", `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files in /public.
    "/((?!_next/static|_next/image|assets/|cesium/|favicon\\.ico|favicon\\.svg|robots\\.txt).*)",
  ],
};
