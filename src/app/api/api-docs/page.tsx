import { Braces, Globe, LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ApplicationLogo } from "@/components/application-logo";
import { env } from "@/env";
import { requireUser } from "@/server/auth";

import { SwaggerUi } from "./swagger-ui";

export const metadata: Metadata = { title: "API Docs" };

const SPEC_URL = "/api/api-docs/openapi.json";

const linkClass =
  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-foreground/75 transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/** Swagger UI for the HTTP API (src/server/openapi), for every signed-in user. */
export default async function ApiDocsPage() {
  await requireUser("/api/api-docs");

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-border bg-neutral/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-2 sm:px-5">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ApplicationLogo className="h-8 w-8 shrink-0" alt={env.APP_NAME} />
            <span className="hidden truncate text-sm font-extrabold uppercase tracking-wider text-primary sm:inline">
              {env.APP_NAME}
            </span>
          </Link>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">API Docs</span>

          <nav className="ms-auto flex items-center gap-1" aria-label="API docs navigation">
            <a href={SPEC_URL} className={linkClass} title="OpenAPI 3.1 document (JSON)">
              <Braces className="size-4" aria-hidden="true" />
              <span className="hidden md:inline">openapi.json</span>
            </a>
            <Link href="/" className={linkClass} title="3D Map">
              <Globe className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">3D Map</span>
            </Link>
            <Link href="/dashboard" className={linkClass} title="Dashboard">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <SwaggerUi url={SPEC_URL} />
      </main>
    </div>
  );
}
