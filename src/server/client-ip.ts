/**
 * Client IP for rate limiting, from proxy headers.
 *
 * X-Forwarded-For is a list the client can pre-fill: only the entries appended by our own reverse
 * proxies are trustworthy. With TRUSTED_PROXY_COUNT reverse proxies in front of the app, the client
 * address is the entry that many hops from the RIGHT end. The leftmost entry (what a naive reader
 * takes) is attacker-controlled and must never be used for limits.
 *
 * Without any proxy (TRUSTED_PROXY_COUNT=0) nothing in the headers can be trusted and every request
 * shares one bucket; the per-account login limit (src/lib/auth.ts) still applies.
 */
type HeaderReader = (name: string) => string | null | undefined;

function trustedProxyCount(): number {
  const value = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);
  return Number.isInteger(value) && value >= 0 ? value : 1;
}

export function clientIpFrom(read: HeaderReader, proxies: number = trustedProxyCount()): string {
  if (proxies === 0) return "untrusted";

  const hops = (read("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (hops.length > 0) {
    // Fewer hops than proxies: the request did not come through the whole proxy chain.
    return hops.length >= proxies ? hops[hops.length - proxies] : "untrusted";
  }

  const realIp = read("x-real-ip")?.trim();
  return realIp || "unknown";
}

/** For plain header objects (next-auth's RequestInternal.headers). */
export function clientIpFromRecord(headers: Record<string, unknown> | undefined): string {
  return clientIpFrom((name) => {
    const value = headers?.[name];
    const first = Array.isArray(value) ? value.join(",") : value;
    return typeof first === "string" ? first : null;
  });
}
