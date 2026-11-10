import { requireApiUser, type CurrentUser } from "@/server/auth";
import { HttpError, readBody } from "@/server/http";
import { limitPerMinute, RATE_LIMITS, type RateLimitName } from "@/server/rate-limit";

/**
 * Upload API guard (Laravel: auth + role:admin + throttle:<name>, limited per user).
 */
export async function requireUploader(limit: RateLimitName): Promise<CurrentUser> {
  const user = await requireApiUser("admin");
  const { allowed, retryAfter } = limitPerMinute(limit, user.id);
  if (!allowed) {
    throw new HttpError(429, "Too Many Attempts.", undefined, {
      "Retry-After": String(retryAfter),
      "X-RateLimit-Limit": String(RATE_LIMITS[limit]),
      "X-RateLimit-Remaining": "0",
    });
  }
  return user;
}

/** Request input; an unreadable multipart body counts as empty input (validation then reports it). */
export async function readInput(request: Request): Promise<Record<string, unknown>> {
  try {
    return await readBody(request);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return {};
  }
}
