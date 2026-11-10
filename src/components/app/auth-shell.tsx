/* eslint-disable @next/next/no-img-element -- full-height decorative background, as in the Laravel view */
import Link from "next/link";
import type { ReactNode } from "react";

import { ApplicationLogo } from "@/components/application-logo";
import { cn } from "@/lib/utils";

/**
 * Split-screen frame of the guest pages (auth/login, forgot-password, reset-password views): the
 * topographic image on the left, logo + branding and the page's form on the right.
 */
export function AuthShell({
  appName,
  panelClassName = "md:p-8 lg:p-10",
  children,
}: {
  appName: string;
  /** Padding of the form column (the login view uses md:p-10 lg:p-12). */
  panelClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Left Side - Background Image */}
      <div className="relative hidden h-full md:block md:w-1/2 lg:w-2/3 xl:w-3/4">
        <img
          src="/assets/img/auth-topography.webp"
          alt="Topographic contour map"
          className="h-full w-full object-cover object-center"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#064e3b]/30 via-[#047857]/15 to-black/30"></div>
      </div>

      {/* Right Side - Form */}
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center overflow-y-auto overflow-x-hidden bg-background p-8 md:w-1/2 lg:w-1/3 xl:w-1/4",
          panelClassName,
        )}
      >
        <div className="w-full max-w-[420px] md:max-w-full lg:max-w-[400px]">
          {/* Logo & Branding */}
          <div className="mb-6 flex flex-col items-center">
            <Link
              href="/"
              className="mb-3 flex h-14 w-14 items-center justify-center rounded-[14px] bg-primary shadow-[0_4px_14px_rgba(26,79,160,0.3)] transition-transform hover:scale-105 active:scale-95"
            >
              <ApplicationLogo className="max-h-10 w-9 max-w-10 brightness-0 invert" alt={appName} />
            </Link>
            <h1 className="mb-2 text-center text-sm font-extrabold uppercase tracking-[0.08em] text-accent">{appName}</h1>
            <div className="h-[3px] w-10 rounded-sm bg-secondary"></div>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}

/** "Remember your password? Back to login" footer of the password pages. */
export function BackToLoginFooter() {
  return (
    <div className="mt-8 text-center">
      <div className="mb-5 h-[1px] w-full bg-border"></div>
      <p className="text-xs text-base-content-muted">
        Remember your password?{" "}
        <Link className="font-bold text-accent transition-colors duration-200 hover:text-primary hover:underline" href="/login">
          Back to login
        </Link>
      </p>
    </div>
  );
}
