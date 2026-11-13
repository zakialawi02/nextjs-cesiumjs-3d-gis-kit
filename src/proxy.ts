import { decode, getToken, type JWT } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import { bearerTokenFrom } from "@/lib/bearer-token";

/**
 * Optimistic auth gate (Next.js 16 "proxy", formerly middleware). It only checks that a session
 * token (cookie) or mobile token (`Authorization: Bearer`) exists; pages, Server Actions and route
 * handlers still verify the user against the database (src/server/auth.ts), which is what actually
 * enforces roles and revoked sessions.
 */
const GUEST_PATHS = ["/login", "/forgot-password", "/reset-password"];

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/auth") ||
    pathname === "/api/mobile/token" ||
    pathname === "/up" ||
    GUEST_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  );
}

/** Paths that answer 401 JSON instead of redirecting to the login page. */
function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/geodata/") || pathname.startsWith("/api/mobile/");
}

/** Terrain requests with a signed `t` (src/server/geodata/terrain-url.ts); the route verifies it. */
function isSignedTerrainRequest(request: NextRequest): boolean {
  return request.nextUrl.pathname.startsWith("/geodata/terrain/") && request.nextUrl.searchParams.has("t");
}

/** A Bearer header is checked on its own (a stale cookie must not shadow it), else the cookie. */
async function requestToken(request: NextRequest, secret: string | undefined): Promise<JWT | null> {
  const bearer = bearerTokenFrom(request.headers.get("authorization"));
  if (bearer === null) return getToken({ req: request, secret });
  if (!secret || bearer === "") return null;
  try {
    return await decode({ token: bearer, secret });
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname) || isSignedTerrainRequest(request)) {
    return NextResponse.next();
  }

  const token = await requestToken(request, process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);

  if (token?.sub && !token.invalid) {
    return NextResponse.next();
  }

  if (isApiPath(pathname)) {
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
