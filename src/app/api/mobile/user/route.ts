import { handler, json } from "@/server/http";
import { presentMobileUser, requireMobileUser } from "@/server/mobile-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mobile/user: the user of the Bearer token, e.g. to check a stored token at app start. */
export const GET = handler(async (request) => {
  const user = await requireMobileUser(request);
  return json({ user: presentMobileUser(user) }, { headers: { "Cache-Control": "no-store" } });
});
