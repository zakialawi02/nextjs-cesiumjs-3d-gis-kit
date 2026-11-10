import { headers } from "next/headers";

import { env } from "@/env";
import { clientIpFrom } from "@/server/client-ip";

/** Client IP for rate limiting in Server Actions (trusted proxy hop; see src/server/client-ip.ts). */
export async function requestIp(): Promise<string> {
  const store = await headers();
  return clientIpFrom((name) => store.get(name));
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
