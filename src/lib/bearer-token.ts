/**
 * The token of an `Authorization: Bearer <token>` header (scheme case-insensitive), or null when the
 * header is missing or uses another scheme. `Bearer` without a token gives "" so callers answer 401
 * instead of falling back to the session cookie. Dependency-free: also used by src/proxy.ts.
 */
export function bearerTokenFrom(header: string | null | undefined): string | null {
  const match = /^Bearer(?:\s+(.*))?$/i.exec(header?.trim() ?? "");
  return match ? (match[1] ?? "").trim() : null;
}
