"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

type ProvidersProps = {
  children: ReactNode;
};

/**
 * Refetching the session every few minutes re-issues the session cookie, which keeps an open tab
 * (e.g. the map) signed in past the idle timeout (SESSION_LIFETIME) without "Remember me".
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
      {children}
    </SessionProvider>
  );
}
