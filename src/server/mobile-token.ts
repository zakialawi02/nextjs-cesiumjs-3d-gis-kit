import type { User as DbUser } from "@prisma/client";
import { decode, encode, type JWT } from "next-auth/jwt";

import { env } from "@/env";
import { bearerTokenFrom } from "@/lib/bearer-token";
import { passwordFingerprint } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/server/http";

/**
 * Bearer tokens for mobile apps and other non-browser clients (POST /api/mobile/token).
 *
 * A mobile token is a NextAuth JWT encrypted with AUTH_SECRET, like the session cookie, plus the
 * claim `mobile: true`; only tokens with that claim are accepted from the Authorization header.
 * It stores the password fingerprint, so deleting the user or changing / resetting their password
 * revokes it. Tokens are stateless: there is no per-token revocation, a client signs out by
 * discarding its token.
 */

export const MOBILE_TOKEN_SECONDS = 30 * 24 * 60 * 60;

export type MobileUser = Pick<DbUser, "id" | "name" | "username" | "email" | "role" | "profile_photo_path" | "password">;

function authSecret(): string | undefined {
  return env.AUTH_SECRET || env.NEXTAUTH_SECRET;
}

export async function issueMobileToken(
  user: Pick<DbUser, "id" | "password">,
): Promise<{ accessToken: string; expiresIn: number; expiresAt: Date }> {
  const secret = authSecret();
  if (!secret) throw new Error("AUTH_SECRET is not configured (npm run generate:auth).");

  const token: JWT = { sub: user.id, pwd: passwordFingerprint(user.password), mobile: true };
  const expiresAt = new Date(Date.now() + MOBILE_TOKEN_SECONDS * 1000);
  const accessToken = await encode({ token, secret, maxAge: MOBILE_TOKEN_SECONDS });
  return { accessToken, expiresIn: MOBILE_TOKEN_SECONDS, expiresAt };
}

/**
 * The active user of a mobile token, or null when the token is malformed, expired, not a mobile
 * token, or revoked (user deleted, password changed since it was issued).
 */
export async function verifyMobileToken(raw: string): Promise<MobileUser | null> {
  const secret = authSecret();
  if (!secret || raw === "") return null;

  let token: JWT | null;
  try {
    token = await decode({ token: raw, secret });
  } catch {
    return null;
  }
  if (!token?.sub || token.mobile !== true || typeof token.pwd !== "string") return null;

  const user = await prisma.user.findUnique({
    where: { id: token.sub },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      role: true,
      profile_photo_path: true,
      password: true,
      deleted_at: true,
    },
  });

  if (!user || user.deleted_at || passwordFingerprint(user.password) !== token.pwd) return null;
  return user;
}

/** Route handlers under /api/mobile: the user of the request's Bearer token, else a 401. */
export async function requireMobileUser(request: Request): Promise<MobileUser> {
  const raw = bearerTokenFrom(request.headers.get("authorization"));
  const user = raw ? await verifyMobileToken(raw) : null;
  if (!user) throw new HttpError(401);
  return user;
}

/** Same shape as `user` of GET /api/auth/session. */
export function presentMobileUser(user: MobileUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.profile_photo_path,
    username: user.username,
    role: user.role,
  };
}

/** Body of POST /api/mobile/token and /api/mobile/token/refresh. */
export async function mobileTokenResponse(user: MobileUser) {
  const { accessToken, expiresIn, expiresAt } = await issueMobileToken(user);
  return {
    token_type: "Bearer" as const,
    access_token: accessToken,
    expires_in: expiresIn,
    expires_at: expiresAt.toISOString(),
    user: presentMobileUser(user),
  };
}

/** Token responses must not be cached (RFC 6749 §5.1). */
export const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;
