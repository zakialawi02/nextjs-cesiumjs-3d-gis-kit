import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import type { Paginator } from "@/server/dashboard/pagination";

/** Port of resources/views/pagination/app.blade.php. Renders nothing when there is a single page. */
export function Pagination({ paginator }: { paginator: Paginator }) {
  if (!paginator.hasPages) return null;

  const box = "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border";

  return (
    <nav className="flex flex-col items-center justify-between gap-3 sm:flex-row" aria-label="Pagination">
      <p className="text-xs text-foreground/60">
        Showing <span className="font-semibold">{paginator.firstItem ?? ""}</span>–
        <span className="font-semibold">{paginator.lastItem ?? ""}</span> of{" "}
        <span className="font-semibold">{paginator.total}</span>
      </p>

      <ul className="flex items-center gap-1">
        <li>
          {paginator.previousPageUrl ? (
            <Link href={paginator.previousPageUrl} rel="prev" className={`${box} hover:bg-muted`} aria-label="Previous page">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span className={`${box} text-foreground/30`} aria-disabled="true">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </span>
          )}
        </li>

        {paginator.elements.map((element, index) =>
          element.type === "dots" ? (
            <li key={`dots-${index}`}>
              <span className="px-1 text-xs text-foreground/40">...</span>
            </li>
          ) : (
            element.pages.map(({ page, url }) => (
              <li key={page}>
                {page === paginator.currentPage ? (
                  <span
                    aria-current="page"
                    className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg bg-primary px-2 text-xs font-bold text-primary-foreground"
                  >
                    {page}
                  </span>
                ) : (
                  <Link
                    href={url}
                    className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border px-2 text-xs hover:bg-muted"
                  >
                    {page}
                  </Link>
                )}
              </li>
            ))
          ),
        )}

        <li>
          {paginator.nextPageUrl ? (
            <Link href={paginator.nextPageUrl} rel="next" className={`${box} hover:bg-muted`} aria-label="Next page">
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span className={`${box} text-foreground/30`} aria-disabled="true">
              <ChevronRight className="size-4" aria-hidden="true" />
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
