import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret-for-mobile-tokens-0123456789";

const { findUnique, findFirst } = vi.hoisted(() => ({ findUnique: vi.fn(), findFirst: vi.fn() }));

vi.mock("@/env", () => ({ env: { SESSION_LIFETIME: 120, AUTH_SECRET: "test-secret-for-mobile-tokens-0123456789" } }));
vi.mock("@/config/geodata", () => ({
  geodataConfig: { dockerComposeBin: "docker compose", dockerComposeFile: "docker-compose.tools.yml" },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique, findFirst } } }));

import { checkCredentials, passwordFingerprint } from "@/lib/auth";
import { bearerTokenFrom } from "@/lib/bearer-token";
import { rateLimiter } from "@/server/rate-limit";
import {
  issueMobileToken,
  mobileTokenResponse,
  MOBILE_TOKEN_SECONDS,
  requireMobileUser,
  verifyMobileToken,
} from "@/server/mobile-token";

const passwordHash = bcrypt.hashSync("secret-password", 4);

const dbUser = {
  id: "0b6f6c2e-6f1e-4c55-9d43-7b0d4b8a1c11",
  name: "Engineering User",
  username: "engineering",
  email: "engineering@mail.com",
  role: "engineering",
  profile_photo_path: "/assets/img/profile/user.png",
  password: passwordHash,
  deleted_at: null as Date | null,
};

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ ...dbUser });
  findFirst.mockReset().mockResolvedValue({ ...dbUser });
});

describe("bearerTokenFrom", () => {
  it.each([
    ["Bearer abc.def", "abc.def"],
    ["bearer   abc.def  ", "abc.def"],
    ["Bearer", ""],
    ["Bearer   ", ""],
  ])("%j → %j", (header, token) => {
    expect(bearerTokenFrom(header)).toBe(token);
  });

  it.each([[null], [undefined], [""], ["Basic dXNlcjpwYXNz"], ["Bearerabc"]])("%j → null (use the cookie)", (header) => {
    expect(bearerTokenFrom(header)).toBeNull();
  });
});

describe("mobile tokens", () => {
  it("round-trips to the active user", async () => {
    const { accessToken, expiresIn } = await issueMobileToken(dbUser);
    expect(expiresIn).toBe(MOBILE_TOKEN_SECONDS);
    await expect(verifyMobileToken(accessToken)).resolves.toMatchObject({ id: dbUser.id, role: "engineering" });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: dbUser.id } }));
  });

  it("is revoked by a password change or deletion", async () => {
    const { accessToken } = await issueMobileToken(dbUser);

    findUnique.mockResolvedValueOnce({ ...dbUser, password: bcrypt.hashSync("new-password", 4) });
    await expect(verifyMobileToken(accessToken)).resolves.toBeNull();

    findUnique.mockResolvedValueOnce({ ...dbUser, deleted_at: new Date() });
    await expect(verifyMobileToken(accessToken)).resolves.toBeNull();

    findUnique.mockResolvedValueOnce(null);
    await expect(verifyMobileToken(accessToken)).resolves.toBeNull();
  });

  it("rejects browser session tokens, expired, foreign and malformed tokens", async () => {
    const pwd = passwordFingerprint(dbUser.password);
    const sessionToken = await encode({ token: { sub: dbUser.id, pwd }, secret: SECRET, maxAge: 3600 });
    const expired = await encode({ token: { sub: dbUser.id, pwd, mobile: true }, secret: SECRET, maxAge: -3600 });
    const foreign = await encode({ token: { sub: dbUser.id, pwd, mobile: true }, secret: "another-secret", maxAge: 3600 });

    for (const token of [sessionToken, expired, foreign, "not-a-token", ""]) {
      await expect(verifyMobileToken(token)).resolves.toBeNull();
    }
  });

  it("requireMobileUser answers 401 without a valid Bearer header", async () => {
    const { accessToken } = await issueMobileToken(dbUser);
    const request = (authorization?: string) =>
      new Request("http://localhost/api/mobile/user", authorization ? { headers: { authorization } } : undefined);

    await expect(requireMobileUser(request(`Bearer ${accessToken}`))).resolves.toMatchObject({ id: dbUser.id });
    await expect(requireMobileUser(request())).rejects.toMatchObject({ status: 401 });
    await expect(requireMobileUser(request("Bearer"))).rejects.toMatchObject({ status: 401 });
    await expect(requireMobileUser(request("Bearer nope"))).rejects.toMatchObject({ status: 401 });
  });

  it("responds with an OAuth-style body and the session user shape", async () => {
    const body = await mobileTokenResponse(dbUser);
    expect(body).toMatchObject({
      token_type: "Bearer",
      expires_in: MOBILE_TOKEN_SECONDS,
      user: {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        image: "/assets/img/profile/user.png",
        username: "engineering",
        role: "engineering",
      },
    });
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now());
    expect(body.user).not.toHaveProperty("password");
  });
});

describe("checkCredentials", () => {
  let ipCounter = 0;
  // A fresh IP per test so the shared in-memory limiter does not carry over between tests.
  const freshIp = () => `198.51.100.${++ipCounter}`;

  beforeEach(() => {
    rateLimiter.clear("login-account:engineering");
  });

  it("accepts the right password and rejects a wrong or empty one", async () => {
    const ip = freshIp();
    await expect(checkCredentials("Engineering ", "secret-password", ip)).resolves.toMatchObject({ ok: true });
    expect(findFirst).toHaveBeenCalledWith({ where: { username: "engineering", deleted_at: null } });

    await expect(checkCredentials("engineering", "wrong", ip)).resolves.toEqual({ ok: false, reason: "failed" });
    await expect(checkCredentials("engineering", "", ip)).resolves.toEqual({ ok: false, reason: "failed" });
    await expect(checkCredentials(undefined, "secret-password", ip)).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("throttles after 5 failures per identifier and IP", async () => {
    const ip = freshIp();
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(checkCredentials("engineering", "wrong", ip)).resolves.toMatchObject({ reason: "failed" });
    }
    const throttled = await checkCredentials("engineering", "secret-password", ip);
    expect(throttled).toMatchObject({ ok: false, reason: "throttled" });
    expect(throttled.ok === false && throttled.reason === "throttled" && throttled.retryAfter).toBeGreaterThan(0);
  });
});
