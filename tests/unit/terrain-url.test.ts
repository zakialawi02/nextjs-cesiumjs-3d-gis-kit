import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/env", () => ({ env: { SESSION_LIFETIME: 120, AUTH_SECRET: "test-secret-for-terrain-urls-0123456789" } }));
vi.mock("@/config/geodata", () => ({
  geodataConfig: { dockerComposeBin: "docker compose", dockerComposeFile: "docker-compose.tools.yml" },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique } } }));

import { signTerrainToken, TERRAIN_URL_SECONDS, verifyTerrainToken, withTerrainToken } from "@/server/geodata/terrain-url";

const LAYER = "01M72BAH0QHEKQHSKV1PV9FCTC";
const OTHER_LAYER = "01M72BAH0QHEKQHSKV1PV9FCTD";
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);

const user = { id: "660d031f-4f10-464c-be5a-e0b6419507c3", password: "$2b$12$hash-of-the-current-password" };

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ password: user.password, deleted_at: null });
});

describe("signed terrain tokens", () => {
  it("is valid for its layer until it expires", async () => {
    const { token, expiresAt } = signTerrainToken(LAYER, user, NOW);
    expect(token).toMatch(/^[0-9a-f-]{36}\.[0-9]+\.[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBe(NOW + TERRAIN_URL_SECONDS * 1000);

    await expect(verifyTerrainToken(LAYER, token, NOW)).resolves.toBe(true);
    await expect(verifyTerrainToken(LAYER, token, expiresAt.getTime() - 1000)).resolves.toBe(true);
    await expect(verifyTerrainToken(LAYER, token, expiresAt.getTime())).resolves.toBe(false);
  });

  it("does not open another layer", async () => {
    const { token } = signTerrainToken(LAYER, user, NOW);
    await expect(verifyTerrainToken(OTHER_LAYER, token, NOW)).resolves.toBe(false);
  });

  it("is revoked by a password change or deletion", async () => {
    const { token } = signTerrainToken(LAYER, user, NOW);

    findUnique.mockResolvedValueOnce({ password: "$2b$12$a-new-password-hash", deleted_at: null });
    await expect(verifyTerrainToken(LAYER, token, NOW)).resolves.toBe(false);

    findUnique.mockResolvedValueOnce({ password: user.password, deleted_at: new Date(NOW) });
    await expect(verifyTerrainToken(LAYER, token, NOW)).resolves.toBe(false);

    findUnique.mockResolvedValueOnce(null);
    await expect(verifyTerrainToken(LAYER, token, NOW)).resolves.toBe(false);
  });

  it("rejects tampered or malformed tokens without touching the database", async () => {
    const { token } = signTerrainToken(LAYER, user, NOW);
    const [id, exp, sig] = token.split(".");
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;

    // A later expiry with the old signature, and a flipped signature character.
    await expect(verifyTerrainToken(LAYER, `${id}.${Number(exp) + 3600}.${sig}`, NOW)).resolves.toBe(false);
    await expect(verifyTerrainToken(LAYER, `${id}.${exp}.${flipped}`, NOW)).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);

    findUnique.mockClear();
    for (const bad of ["", "garbage", `${id}.${exp}`, `------------------------------------.${exp}.${sig}`, `${id.toUpperCase()}.${exp}.${sig}`]) {
      await expect(verifyTerrainToken(LAYER, bad, NOW)).resolves.toBe(false);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("appends the token to layer.json tile templates", () => {
    expect(withTerrainToken("{z}/{x}/{y}.terrain?v=1.0.0&terrain_revision=3", "a.1.b")).toBe(
      "{z}/{x}/{y}.terrain?v=1.0.0&terrain_revision=3&t=a.1.b",
    );
    expect(withTerrainToken("{z}/{x}/{y}.terrain", "a.1.b")).toBe("{z}/{x}/{y}.terrain?t=a.1.b");
  });
});
