import { describe, expect, it } from "vitest";

import { pageUrl, pageWindow, paginate, resolvePage } from "@/server/dashboard/pagination";

describe("pageWindow (Laravel UrlWindow, onEachSide = 3)", () => {
  it("lists every page below 14 pages", () => {
    expect(pageWindow(1, 1)).toEqual([[1]]);
    expect(pageWindow(5, 13)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]]);
  });

  it("slides near the beginning", () => {
    expect(pageWindow(3, 20)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "...", [19, 20]]);
  });

  it("slides near the end", () => {
    expect(pageWindow(18, 20)).toEqual([[1, 2], "...", [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]]);
  });

  it("shows a full slider in the middle", () => {
    expect(pageWindow(10, 20)).toEqual([[1, 2], "...", [7, 8, 9, 10, 11, 12, 13], "...", [19, 20]]);
  });
});

describe("resolvePage", () => {
  it.each([
    [undefined, 1],
    ["3", 3],
    ["0", 1],
    ["-2", 1],
    ["abc", 1],
    ["2.5", 1],
    [["4", "5"], 4],
  ])("%j → %d", (value, expected) => {
    expect(resolvePage(value)).toBe(expected);
  });
});

describe("paginate", () => {
  it("keeps the query string and replaces the page", () => {
    expect(pageUrl("/dashboard/users", { search: "ann", role: "admin", page: "1" }, 2)).toBe(
      "/dashboard/users?search=ann&role=admin&page=2",
    );
  });

  it("describes the current page", () => {
    const paginator = paginate({ total: 31, currentPage: 2, itemCount: 15, path: "/x", query: {} });
    expect(paginator).toMatchObject({
      lastPage: 3,
      firstItem: 16,
      lastItem: 30,
      hasPages: true,
      previousPageUrl: "/x?page=1",
      nextPageUrl: "/x?page=3",
    });
  });

  it("has no pages for a single page of results", () => {
    expect(paginate({ total: 15, currentPage: 1, itemCount: 15, path: "/x", query: {} }).hasPages).toBe(false);
    expect(paginate({ total: 0, currentPage: 1, itemCount: 0, path: "/x", query: {} }).firstItem).toBeNull();
  });
});
