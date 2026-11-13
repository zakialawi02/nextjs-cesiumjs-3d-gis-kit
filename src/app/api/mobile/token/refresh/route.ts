import { handler, json } from "@/server/http";
import { mobileTokenResponse, NO_STORE, requireMobileUser } from "@/server/mobile-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mobile/token/refresh: a fresh token (new 30-day expiry) for a still-valid Bearer token.
 * The old token stays valid until it expires; clients simply replace it.
 */
export const POST = handler(async (request) => {
  const user = await requireMobileUser(request);
  return json(await mobileTokenResponse(user), { headers: NO_STORE });
});
