import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import type { NextAuthOptions, Profile, User as NextAuthUser } from "next-auth";
import { encode as encodeJwt } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import DiscordProvider from "next-auth/providers/discord";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

import { env } from "@/env";
import { UserRole } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { clientIpFromRecord } from "@/server/client-ip";
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
  oauthProviders.push(
    GitHubProvider({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
      // next-auth's default takes the primary address from /user/emails without checking that
      // GitHub verified it. Use only the primary *verified* address and record that it is verified.
      userinfo: {
        url: "https://api.github.com/user",
        async request({ client, tokens }) {
          const profile = (await client.userinfo(tokens.access_token!)) as Record<string, unknown>;
          const response = await fetch("https://api.github.com/user/emails", {
            headers: { Authorization: `token ${tokens.access_token}`, Accept: "application/vnd.github+json" },
          });
          const emails = response.ok
            ? ((await response.json()) as Array<{ email: string; primary: boolean; verified: boolean }>)
            : [];
          const verified = emails.find((entry) => entry.primary && entry.verified);
          return { ...profile, email: verified?.email, email_verified: Boolean(verified) } as Profile;
        },
      },
    }),
  );
}
if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
  oauthProviders.push(GoogleProvider({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }));
}

/** OAuth providers shown as buttons on the login page. */
export const configuredOAuthProviders = oauthProviders.map((provider) => ({
  id: provider.id,
  name: provider.name,
}));

/**
 * Whether the OAuth provider positively reports the profile email as verified. Unknown providers
 * and missing flags count as unverified.
 */
export function isProviderEmailVerified(provider: string, profile: unknown): boolean {
  const claims = (profile ?? {}) as { email_verified?: unknown; verified?: unknown };
  switch (provider) {
    case "google":
    case "github": // set by the GitHub userinfo override above
      return claims.email_verified === true;
    case "discord":
      return claims.verified === true;
    default:
      return false;
  }
}

/** Short fingerprint of the stored password hash; a password change invalidates older tokens. */
export function passwordFingerprint(passwordHash: string | null | undefined): string {
  return createHash("sha256")
    .update(passwordHash ?? "no-password")
    .digest("hex")
    .slice(0, 16);
}

// Compared against when the identifier is unknown, so response time does not reveal accounts.
const DUMMY_HASH = "$2b$12$ixEvgas5RnGIVqdkQGDeKukpJhWFRwjCu0pWtCRr21mX7M2UMraa.";

/**
 * Failed attempts per account, regardless of IP: caps password guessing against one account even
 * when the client IP cannot be trusted (no reverse proxy) or the attacker rotates addresses.
 */
const ACCOUNT_MAX_FAILURES = 20;
const ACCOUNT_WINDOW_SECONDS = 15 * 60;

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

    const ip = clientIpFromRecord(req?.headers as Record<string, unknown> | undefined);
    const ipKey = `login:${ip}`;
    const throttleKey = `login-identifier:${identifier}|${ip}`;
    const accountKey = `login-account:${identifier}`;

    if (rateLimiter.tooManyAttempts(accountKey, ACCOUNT_MAX_FAILURES)) {
      throw new Error(AUTH_MESSAGES.throttle(rateLimiter.availableIn(accountKey)));
    }

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
      rateLimiter.hit(accountKey, ACCOUNT_WINDOW_SECONDS);
      throw new Error(AUTH_MESSAGES.failed);
    }

    rateLimiter.clear(throttleKey);
    rateLimiter.clear(accountKey);

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

  // Link only to accounts whose own email address is verified (admin-created accounts, or a user
  // who has not changed their email since): otherwise anyone could pre-register an address they
  // don't own and receive the real owner's OAuth sign-in.
  if (user?.deleted_at || (user && !user.email_verified_at)) return { error: "oauth_no_account" };

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

      // An OAuth email is only trusted when the provider positively says it verified it; anyone can
      // sign up at a provider with someone else's (unverified) address.
      const verified = isProviderEmailVerified(account.provider, profile);
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
