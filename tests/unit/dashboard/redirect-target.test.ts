import { describe, expect, it } from "vitest";

import { internalRedirectPath } from "@/server/dashboard/redirect-target";

const ORIGINS = ["http://localhost:3000", "https://gis.example.com/"];

describe("internalRedirectPath", () => {
  // Same cases as Laravel's tests/Feature/Auth/LoginRedirectTest.php.
  it.each([
    ["external https", "https://www.linkedin.com/"],
    ["external http", "http://evil.example/dashboard"],
    ["protocol relative", "//evil.example/dashboard"],
    ["backslash trick", "/\\evil.example"],
    ["scheme without host", "https:evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["lookalike host", "http://localhost:3000.evil.example/"],
    ["credentials in url", "http://user@localhost:3000/dashboard"],
    ["relative without slash", "dashboard"],
    ["empty value", ""],
    ["control character", "/dash\nboard"],
    ["space", "/dash board"],
    ["same host, other port", "http://localhost:4000/dashboard"],
    ["same host, other scheme", "https://localhost:3000/dashboard"],
    ["not a string", ["/dashboard"]],
    // Paths that only become protocol-relative after URL normalisation (security review fix).
    ["dot segment before double slash", "/.//evil.example"],
    ["parent segment before double slash", "/a/..//evil.example"],
    ["encoded dot segment", "/%2e//evil.example"],
    ["same origin with double slash path", "http://localhost:3000//evil.example"],
  ])("rejects %s", (_label, target) => {
    expect(internalRedirectPath(target, ORIGINS)).toBeNull();
  });

  it.each([
    ["relative path with query", "/profile?tab=password", "/profile?tab=password"],
    ["relative path with fragment", "/dashboard/layers?page=2#top", "/dashboard/layers?page=2#top"],
    ["root", "/", "/"],
    ["absolute app url", "http://localhost:3000/dashboard", "/dashboard"],
    ["absolute APP_URL with trailing slash in config", "https://gis.example.com/dashboard/users", "/dashboard/users"],
    ["origin compared case-insensitively", "HTTP://LOCALHOST:3000/profile", "/profile"],
    ["origin without path", "http://localhost:3000", "/"],
  ])("keeps %s", (_label, target, expected) => {
    expect(internalRedirectPath(target, ORIGINS)).toBe(expected);
  });
});
