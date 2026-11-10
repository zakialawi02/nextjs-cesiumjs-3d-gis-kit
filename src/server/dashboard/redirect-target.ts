/**
 * Post-login redirect sanitiser (port of AuthenticatedSessionController::internalRedirectPath).
 *
 * Reduces a `?redirect=` target to a local path ("/profile?tab=x#y"), or null when it would leave
 * the application: other hosts, protocol-relative URLs, backslash tricks, schemes without "//",
 * credentials in the URL, relative paths without a leading slash, control characters.
 */
const UNSAFE_CHARACTERS = /[\x00-\x20\x7F\\]/;
const ABSOLUTE_URL = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const PLACEHOLDER_ORIGIN = "http://redirect.invalid";

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "").toLowerCase();
}

export function internalRedirectPath(target: unknown, allowedOrigins: readonly string[]): string | null {
  if (typeof target !== "string" || target === "" || UNSAFE_CHARACTERS.test(target)) {
    return null;
  }

  let url: URL;

  if (target.startsWith("/")) {
    if (target.startsWith("//")) return null;
    try {
      url = new URL(target, PLACEHOLDER_ORIGIN);
    } catch {
      return null;
    }
    if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  } else {
    // Only "scheme://host" URLs can point back here; "https:evil.example" or "javascript:" cannot.
    if (!ABSOLUTE_URL.test(target)) return null;
    try {
      url = new URL(target);
    } catch {
      return null;
    }
    if (url.username !== "" || url.password !== "" || url.host === "") return null;

    const origin = normalizeOrigin(`${url.protocol}//${url.host}`);
    const allowed = allowedOrigins.filter(Boolean).map(normalizeOrigin);
    if (!allowed.includes(origin)) return null;
  }

  return `${url.pathname || "/"}${url.search}${url.hash}`;
}
