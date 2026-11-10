import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import type { NextAuthOptions, User as NextAuthUser } from "next-auth";
import { encode as encodeJwt } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import DiscordProvider from "next-auth/providers/discord";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

import { env } from "@/env";
import { UserRole } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { rateLimiter, RATE_LIMITS } from "@/server/rate-limit";

/**
 * Authentication with two methods:
 *
 * 1. Credentials: username or email + password (port of Laravel's LoginRequest), throttled per
 *    identifier + IP (5 attempts) and per IP (20/min).
 * 2. OAuth (Discord, GitHub, Google), enabled per provider through env vars. OAuth links to an
 *    existing, non-deleted account with the same email. Unknown emails are refused unless
 *    AUTH_OAUTH_ALLOW_SIGNUP=true, which creates an "engineering" account.
 *
 * Sessions are JWTs. On every read the token is re-checked against the database, so deleting a user
 * or changing / resetting a password signs out every other session (Laravel's authenticateSessions).
 * Without "Remember me" a session expires after SESSION_LIFETIME idle minutes; the client keeps an
 * open tab alive by refetching /api/auth/session (see app/providers.tsx).
 */

const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
const IDLE_SECONDS = env.SESSION_LIFETIME * 60;

export const AUTH_MESSAGES = {
  failed: "These credentials do not match our records.",
  throttle: (seconds: number) =>
    `Too many login attempts. Please try again in ${seconds} seconds.`,
  oauthNoAccount: "No account is linked to this sign-in. Ask an administrator to create your account first.",
  oauthNoEmail: "The provider did not share a verified email address.",
} as const;

const oauthProviders: NextAuthOptions["providers"] = [];

if (env.AUTH_DISCORD_ID && env.AUTH_DISCORD_SECRET) {
  oauthProviders.push(DiscordProvider({ clientId: env.AUTH_DISCORD_ID, clientSecret: env.AUTH_DISCORD_SECRET }));
}
if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) {
  oauthProviders.push(GitHubProvider({ clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET }));
}
if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
  oauthProviders.push(GoogleProvider({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }));
}

/** OAuth providers shown as buttons on the login page. */
export const configuredOAuthProviders = oauthProviders.map((provider) => ({
  id: provider.id,
  name: provider.name,
}));

/** Short fingerprint of the stored password hash; a password change invalidates older tokens. */
export function passwordFingerprint(passwordHash: string | null | undefined): string {
  return createHash("sha256")
    .update(passwordHash ?? "no-password")
    .digest("hex")
    .slice(0, 16);
}

// Compared against when the identifier is unknown, so response time does not reveal accounts.
const DUMMY_HASH = "$2b$12$ixEvgas5RnGIVqdkQGDeKukpJhWFRwjCu0pWtCRr21mX7M2UMraa.";

function clientIpFromHeaders(headers: Record<string, unknown> | undefined): string {
  const forwarded = headers?.["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof value === "string" && value.trim() !== "") return value.split(",")[0].trim();
  const realIp = headers?.["x-real-ip"];
  return typeof realIp === "string" && realIp !== "" ? realIp : "unknown";
}

const credentialsProvider = CredentialsProvider({
  id: "credentials",
  name: "Username",
  credentials: {
    id_user: { label: "Username or email", type: "text" },
    password: { label: "Password", type: "password" },
    remember: { label: "Remember me", type: "text" },
  },
  async authorize(credentials, req) {
    const identifier =
      typeof credentials?.id_user === "string" ? credentials.id_user.trim().toLowerCase() : "";
    const password = typeof credentials?.password === "string" ? credentials.password : "";

    if (identifier === "" || identifier.length > 255 || password === "") {
      throw new Error(AUTH_MESSAGES.failed);
    }

    const ip = clientIpFromHeaders(req?.headers as Record<string, unknown> | undefined);
    const ipKey = `login:${ip}`;
    const throttleKey = `login-identifier:${identifier}|${ip}`;

    if (rateLimiter.tooManyAttempts(ipKey, RATE_LIMITS.login)) {
      throw new Error(AUTH_MESSAGES.throttle(rateLimiter.availableIn(ipKey)));
    }
    rateLimiter.hit(ipKey, 60);

    if (rateLimiter.tooManyAttempts(throttleKey, RATE_LIMITS["login-identifier"])) {
      throw new Error(AUTH_MESSAGES.throttle(rateLimiter.availableIn(throttleKey)));
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const user = await prisma.user.findFirst({
      where: { ...(isEmail ? { email: identifier } : { username: identifier }), deleted_at: null },
    });

    const valid = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    if (!user || !user.password || !valid) {
      rateLimiter.hit(throttleKey, 60);
      throw new Error(AUTH_MESSAGES.failed);
    }

    rateLimiter.clear(throttleKey);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.profile_photo_path,
      remember: credentials?.remember === "true" || credentials?.remember === "on",
    } as NextAuthUser;
  },
});

function usernameBase(email: string, name?: string | null): string {
  const base = (email.split("@")[0] || name || "user")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 40);
  return base.length >= 3 ? base : `user${base}`;
}

async function uniqueUsername(email: string, name?: string | null): Promise<string> {
  const base = usernameBase(email, name);
  let candidate = base;
  for (let i = 2; await prisma.user.findUnique({ where: { username: candidate } }); i++) {
    candidate = `${base}${i}`;
  }
  return candidate;
}

/**
 * Finds (or, when sign-up is allowed, creates) the local account for an OAuth identity.
 * Returns the local user id, or a login-page error URL.
 */
async function resolveOAuthUser(
  provider: string,
  providerAccountId: string,
  type: string,
  email: string | null | undefined,
  name: string | null | undefined,
): Promise<{ userId: string } | { error: string }> {
  const linked = await prisma.account.findUnique({
    where: { provider_provider_account_id: { provider, provider_account_id: providerAccountId } },
    include: { user: true },
  });

  if (linked) {
    return linked.user.deleted_at ? { error: "oauth_no_account" } : { userId: linked.user_id };
  }

  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return { error: "oauth_no_email" };

  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (user?.deleted_at) return { error: "oauth_no_account" };

  if (!user) {
    if (!env.AUTH_OAUTH_ALLOW_SIGNUP) return { error: "oauth_no_account" };
    user = await prisma.user.create({
      data: {
        name: name?.trim() || normalizedEmail,
        username: await uniqueUsername(normalizedEmail, name),
        email: normalizedEmail,
        email_verified_at: new Date(),
        password: null,
        role: UserRole.Engineering,
      },
    });
  }

  await prisma.account.create({
    data: { user_id: user.id, provider, provider_account_id: providerAccountId, type },
  });

  return { userId: user.id };
}

export const authOptions: NextAuthOptions = {
  secret: env.AUTH_SECRET || env.NEXTAUTH_SECRET,
  providers: [credentialsProvider, ...oauthProviders],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    // Cookie lifetime; the token inside expires earlier unless "Remember me" was ticked.
    maxAge: REMEMBER_SECONDS,
  },
  jwt: {
    encode: (params) =>
      encodeJwt({ ...params, maxAge: params.token?.remember ? REMEMBER_SECONDS : IDLE_SECONDS }),
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials") return true;

      // GitHub returns `email: null` for private addresses unless the user:email scope applies;
      // next-auth then fetches the primary verified email into `user.email`.
      const verified =
        account.provider !== "google" ||
        (profile as { email_verified?: boolean } | undefined)?.email_verified !== false;
      const result = await resolveOAuthUser(
        account.provider,
        account.providerAccountId,
        account.type,
        verified ? user.email : null,
        user.name,
      );

      if ("error" in result) return `/login?error=${result.error}`;

      // Carry the local user id into the jwt callback.
      user.id = result.userId;
      return true;
    },

    async jwt({ token, user, account }) {
      if (user) {
        token.sub = user.id;
        token.remember = account?.provider === "credentials" ? Boolean(user.remember) : true;
        token.provider = account?.provider ?? "credentials";
        token.pwd = undefined;
        token.invalid = false;
      }

      if (!token.sub || token.invalid) return { ...token, invalid: true };

      const dbUser = await prisma.user.findUnique({
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

      if (!dbUser || dbUser.deleted_at) return { sub: token.sub, invalid: true };

      const fingerprint = passwordFingerprint(dbUser.password);
      if (token.pwd === undefined) {
        token.pwd = fingerprint;
      } else if (token.pwd !== fingerprint) {
        return { sub: token.sub, invalid: true };
      }

      token.name = dbUser.name;
      token.email = dbUser.email;
      token.picture = dbUser.profile_photo_path;
      token.username = dbUser.username;
      token.role = dbUser.role;
      return token;
    },

    async session({ session, token }) {
      if (token.invalid || !token.sub || !token.role) {
        return { expires: session.expires, invalid: true };
      }

      session.user = {
        id: token.sub,
        name: token.name ?? "",
        email: token.email ?? "",
        image: token.picture ?? null,
        username: token.username ?? "",
        role: token.role,
      };
      return session;
    },
  },
};
