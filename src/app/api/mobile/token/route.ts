import { AUTH_MESSAGES, checkCredentials } from "@/lib/auth";
import { clientIp, handler, HttpError, json, readBody, validationError } from "@/server/http";
import { mobileTokenResponse, NO_STORE } from "@/server/mobile-token";
import { validateRequest } from "@/server/services/upload/request-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mobile/token: signs in with username / email + password and returns a Bearer token for
 * mobile apps and other non-browser clients. Counts against the same login throttles as the login
 * form. OAuth-only accounts (no password) cannot use it.
 */
export const POST = handler(async (request) => {
  const input = await readBody(request);
  await validateRequest(input, {
    id_user: ["required", "string", { max: 255 }],
    password: ["required", "string"],
  });

  // The raw password: validation trims strings, but passwords are compared as typed.
  const result = await checkCredentials(input.id_user, input.password, clientIp(request));
  if (!result.ok) {
    if (result.reason === "throttled") {
      throw new HttpError(429, AUTH_MESSAGES.throttle(result.retryAfter), undefined, {
        "Retry-After": String(result.retryAfter),
      });
    }
    validationError({ id_user: AUTH_MESSAGES.failed });
  }

  return json(await mobileTokenResponse(result.user), { headers: NO_STORE });
});
