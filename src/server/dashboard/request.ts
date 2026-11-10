import { headers } from "next/headers";

import { env } from "@/env";

/** Client IP for rate limiting in Server Actions (first X-Forwarded-For hop, then X-Real-IP). */
export async function requestIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return store.get("x-real-ip") ?? "unknown";
}

/**
 * Origins a post-login redirect may point to: the origin of this request and APP_URL
 * (Laravel: $request->getSchemeAndHttpHost() and config('app.url')).
 */
export async function requestOrigins(): Promise<string[]> {
  const store = await headers();
  const host = store.get("x-forwarded-host") ?? store.get("host");
  const proto = store.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(env.APP_URL).protocol.replace(":", "");
  return [host ? `${proto}://${host}` : null, env.APP_URL.replace(/\/+$/, "")].filter(
    (origin): origin is string => Boolean(origin),
  );
}
