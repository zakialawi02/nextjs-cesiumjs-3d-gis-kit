import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { SESSION_LIFETIME: 120 } }));
vi.mock("@/config/geodata", () => ({
  geodataConfig: { dockerComposeBin: "docker compose", dockerComposeFile: "docker-compose.tools.yml" },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isProviderEmailVerified } from "@/lib/auth";
import { clientIpFrom } from "@/server/client-ip";
import { inputDriverFor } from "@/server/services/conversion/gdal-service";

// Regression tests for the focused security review (OAuth linking, client IP, GDAL input driver).

describe("isProviderEmailVerified", () => {
  it.each([
    ["google", { email_verified: true }, true],
    ["google", { email_verified: false }, false],
    ["google", {}, false],
    ["github", { email_verified: true }, true],
    ["github", {}, false],
    ["discord", { verified: true }, true],
    ["discord", { verified: false }, false],
    ["discord", {}, false],
    ["unknown", { email_verified: true, verified: true }, false],
  ])("%s %j → %s", (provider, profile, expected) => {
    expect(isProviderEmailVerified(provider, profile)).toBe(expected);
  });
});

describe("clientIpFrom", () => {
  const headers = (values: Record<string, string>) => (name: string) => values[name] ?? null;

  it("takes the hop appended by the trusted proxy, not the client-supplied first entry", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), 1)).toBe("203.0.113.9");
    expect(clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }), 2)).toBe("203.0.113.9");
  });

  it("does not trust headers without a proxy, or a chain shorter than the proxy count", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6" }), 0)).toBe("untrusted");
    expect(clientIpFrom(headers({ "x-forwarded-for": "6.6.6.6" }), 2)).toBe("untrusted");
  });

  it("falls back to X-Real-IP, then unknown", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "198.51.100.4" }), 1)).toBe("198.51.100.4");
    expect(clientIpFrom(headers({}), 1)).toBe("unknown");
  });
});

describe("inputDriverFor", () => {
  it.each([
    ["/x/a.dxf", "DXF"],
    ["/x/a.DWG", "CAD"],
    ["/x/a.geojson", "GeoJSON"],
    ["/x/a.shp", "ESRI Shapefile"],
  ])("%s → %s", (file, driver) => {
    expect(inputDriverFor(file)).toBe(driver);
  });

  it("refuses other extensions instead of letting GDAL guess", () => {
    expect(() => inputDriverFor("/x/a.vrt")).toThrow("Unsupported vector input type");
  });
});
