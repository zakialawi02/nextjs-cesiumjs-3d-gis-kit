import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/env";
import { passwordFingerprint } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Signed terrain URLs for clients that cannot send an Authorization header with tile requests
 * (Cesium for Unity's Cesium3DTileset has no request-header option).
 *
 * GET /api/mobile/layers/{layerId}/terrain-url returns `/geodata/terrain/<id>/layer.json?t=<token>`;
 * the terrain route accepts `t` instead of a session and writes the same `t` into the tile URL
 * templates of that layer.json, so every tile request carries it.
 *
 * token = `<user id>.<exp>.<sig>`, sig = HMAC-SHA256(key, layer id, user id, password fingerprint, exp).
 * It works for that one layer only and until `exp`; deleting the user or changing their password
 * revokes it, like sessions and mobile tokens.
 */

export const TERRAIN_URL_SECONDS = 12 * 60 * 60;

// A malformed uuid must not reach Postgres (it would answer 500, not 401).
const TOKEN_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/;

/** A key of its own, derived from AUTH_SECRET, so these signatures cannot be reused elsewhere. */
function signingKey(): Buffer | null {
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  return secret ? createHmac("sha256", secret).update("geodata-terrain-url:v1").digest() : null;
}

function sign(key: Buffer, layerId: string, userId: string, pwd: string, exp: number): string {
  return createHmac("sha256", key).update(`${layerId}\n${userId}\n${pwd}\n${exp}`).digest("base64url");
}

export function signTerrainToken(
  layerId: string,
  user: { id: string; password: string | null },
  now: number = Date.now(),
): { token: string; expiresAt: Date } {
  const key = signingKey();
  if (!key) throw new Error("AUTH_SECRET is not configured (npm run generate:auth).");

  const exp = Math.floor(now / 1000) + TERRAIN_URL_SECONDS;
  const sig = sign(key, layerId, user.id, passwordFingerprint(user.password), exp);
  return { token: `${user.id}.${exp}.${sig}`, expiresAt: new Date(exp * 1000) };
}

/** Whether `token` grants access to `layerId`'s terrain right now. */
export async function verifyTerrainToken(layerId: string, token: string, now: number = Date.now()): Promise<boolean> {
  const key = signingKey();
  const match = TOKEN_PATTERN.exec(token);
  if (!key || !match) return false;

  const [, userId, expText, sig] = match;
  const exp = Number(expText);
  if (exp * 1000 <= now) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true, deleted_at: true },
  });
  if (!user || user.deleted_at) return false;

  const expected = Buffer.from(sign(key, layerId, userId, passwordFingerprint(user.password), exp));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Tile URL templates of a layer.json, with `t` appended so tile requests carry the token. */
export function withTerrainToken(template: string, token: string): string {
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}t=${encodeURIComponent(token)}`;
}
