/**
 * Length-aware pagination (port of Laravel's LengthAwarePaginator + UrlWindow with `withQueryString()`),
 * rendered by src/components/app/pagination.tsx.
 */

export const PER_PAGE = 15;

export type PaginationElement = { type: "pages"; pages: Array<{ page: number; url: string }> } | { type: "dots" };

export type Paginator = {
  currentPage: number;
  lastPage: number;
  total: number;
  perPage: number;
  firstItem: number | null;
  lastItem: number | null;
  hasPages: boolean;
  previousPageUrl: string | null;
  nextPageUrl: string | null;
  elements: PaginationElement[];
};

/** The requested page number: a positive integer, otherwise 1. */
export function resolvePage(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\+?\d+$/.test(raw.trim())) return 1;
  const page = Number.parseInt(raw, 10);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function range(from: number, to: number): number[] {
  const pages: number[] = [];
  for (let page = from; page <= to; page++) pages.push(page);
  return pages;
}

/**
 * Page number groups with "..." gaps, as Laravel's UrlWindow builds them (onEachSide = 3):
 * every page below 14 pages, otherwise the start, a slider around the current page and the end.
 */
export function pageWindow(currentPage: number, lastPage: number, onEachSide = 3): Array<number[] | "..."> {
  if (lastPage <= 1) return [range(1, Math.max(lastPage, 1))];
  if (lastPage < onEachSide * 2 + 8) return [range(1, lastPage)];

  const window = onEachSide + 4;
  const start = range(1, 2);
  const finish = range(lastPage - 1, lastPage);

  if (currentPage <= window) {
    return [range(1, window + onEachSide), "...", finish];
  }
  if (currentPage > lastPage - window) {
    return [start, "...", range(lastPage - (window + (onEachSide - 1)), lastPage)];
  }
  return [start, "...", range(currentPage - onEachSide, currentPage + onEachSide), "...", finish];
}

/** `path?<query>&page=N`, keeping the current query string (minus the page parameter). */
export function pageUrl(path: string, query: Record<string, string>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== "page") params.append(key, value);
  }
  params.set("page", String(page));
  return `${path}?${params.toString()}`;
}

/** Flattens Next.js searchParams into single string values (first value wins). */
export function queryFromSearchParams(searchParams: Record<string, string | string[] | undefined>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") query[key] = first;
  }
  return query;
}

export function paginate(options: {
  total: number;
  currentPage: number;
  perPage?: number;
  itemCount: number;
  path: string;
  query: Record<string, string>;
}): Paginator {
  const perPage = options.perPage ?? PER_PAGE;
  const { total, currentPage, itemCount, path, query } = options;
  const lastPage = Math.max(Math.ceil(total / perPage), 1);
  const firstItem = itemCount > 0 ? (currentPage - 1) * perPage + 1 : null;
  const url = (page: number) => pageUrl(path, query, page);

  return {
    currentPage,
    lastPage,
    total,
    perPage,
    firstItem,
    lastItem: firstItem === null ? null : firstItem + itemCount - 1,
    hasPages: currentPage !== 1 || currentPage < lastPage,
    previousPageUrl: currentPage > 1 ? url(currentPage - 1) : null,
    nextPageUrl: currentPage < lastPage ? url(currentPage + 1) : null,
    elements: pageWindow(currentPage, lastPage).map((element) =>
      element === "..." ? { type: "dots" } : { type: "pages", pages: element.map((page) => ({ page, url: url(page) })) },
    ),
  };
}
