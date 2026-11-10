import { decode, encode } from "next-auth/jwt";
import { cookies } from "next/headers";

import { env } from "@/env";
import { passwordFingerprint } from "@/lib/auth";

/**
 * After the signed-in user changes their own password, every token carrying the old password
 * fingerprint is rejected (src/lib/auth.ts). This re-issues the CURRENT browser's session cookie
 * with the new fingerprint so only the other sessions are signed out (Laravel's
 * logoutOtherDevices + session()->regenerate()). Call from a Server Action, after verifying the
 * current password and saving the new hash.
 */
export async function reissueSessionCookie(newPasswordHash: string): Promise<void> {
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  if (!secret) return;

  const secure = (env.NEXTAUTH_URL ?? env.APP_URL).startsWith("https://");
  const name = `${secure ? "__Secure-" : ""}next-auth.session-token`;
  const store = await cookies();
  const current = store.get(name)?.value;
  if (!current) return;

  const token = await decode({ token: current, secret });
  if (!token?.sub) return;

  const remember = Boolean(token.remember);
  const maxAge = remember ? 30 * 24 * 60 * 60 : env.SESSION_LIFETIME * 60;
  const { exp: _exp, iat: _iat, jti: _jti, ...claims } = token;
  void _exp;
  void _iat;
  void _jti;

  const fresh = await encode({
    token: { ...claims, pwd: passwordFingerprint(newPasswordHash), invalid: false },
    secret,
    maxAge,
  });

  store.set(name, fresh, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 30 * 24 * 60 * 60,
  });
}
