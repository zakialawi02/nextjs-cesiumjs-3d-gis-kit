/**
 * Client helpers for calling Server Actions from event handlers.
 */

/**
 * Re-throws Next.js navigation signals (redirect(), notFound(), forbidden()) raised by a Server
 * Action so the router can handle them; other errors are left to the caller.
 */
export function rethrowNavigationError(error: unknown): void {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND")
  ) {
    throw error;
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again.";
