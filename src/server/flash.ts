import { cookies } from "next/headers";

import type { ToastType } from "@/lib/client/toast";

/**
 * One-time toast for the next page view (Laravel's `->with('success', ...)` session flash).
 * Call from Server Actions or route handlers before redirect(); <ClientBootstrap> shows and
 * clears it on the next navigation. Server Actions that stay on the page can instead return
 * a message and call `toast` on the client.
 */
export const FLASH_COOKIE = "flash";

export async function setFlash(type: ToastType, message: string): Promise<void> {
  const store = await cookies();
  store.set(FLASH_COOKIE, JSON.stringify({ type, message }), {
    path: "/",
    maxAge: 60,
    sameSite: "lax",
    httpOnly: false,
  });
}
