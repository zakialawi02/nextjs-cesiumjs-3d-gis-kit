import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { APP_NAME: "Test GIS", SESSION_LIFETIME: 120 } }));
vi.mock("@/config/geodata", () => ({
  geodataConfig: {
    maxUploadMb: 1000,
    allowedExtensions: ["tif", "tiff", "geotiff", "geojson", "dxf", "dwg", "str", "zip"],
    upload: {
      chunkBytes: 2 * 1024 * 1024,
      sessionHours: 24,
      maxActiveSessions: 4,
      maxInflightMb: 2000,
      minFreeDiskMb: 512,
      zipMaxEntries: 1000,
      zipMaxUncompressedMb: 2000,
      zipMaxRatio: 100,
    },
    utm: { epsg: "EPSG:32649" },
    terrain: { minZoom: 0, maxZoom: 15 },
  },
}));

import { buildOpenApiSpec } from "@/server/openapi/spec";
import { currentOpenApiSettings } from "@/server/openapi/settings";
import type { OperationObject, ParameterObject } from "@/server/openapi/types";

const APP_DIR = path.resolve(__dirname, "../../src/app");
const spec = buildOpenApiSpec();

function resolveRef(ref: string): unknown {
  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
}

function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item) => collectRefs(item, refs));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** App Router segments of a route file, without route groups. */
function routeSegments(file: string): string[] {
  return path
    .relative(APP_DIR, path.dirname(file))
    .split(path.sep)
    .filter((segment) => !/^\(.*\)$/.test(segment));
}

/** Whether the documented path is served by the route with these segments ([...x] catch-alls included). */
function matchesRoute(specPath: string, segments: string[]): boolean {
  const parts = specPath.split("/").filter(Boolean);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (/^\[\.\.\..+\]$/.test(segment)) return index < parts.length;
    if (index >= parts.length) return false;
    if (/^\[.+\]$/.test(segment)) continue;
    if (segment !== parts[index]) return false;
  }
  return segments.length === parts.length;
}

const routes = routeFiles(APP_DIR).map((file) => ({ file, segments: routeSegments(file) }));

/** Next.js precedence: static segments before [dynamic] before [...catch-all], left to right. */
function specificity(segments: string[]): string {
  return segments.map((segment) => (/^\[\.\.\./.test(segment) ? "0" : /^\[/.test(segment) ? "1" : "2")).join("");
}

/** The route file that serves a documented path. */
function routeFor(specPath: string) {
  return routes
    .filter(({ segments }) => matchesRoute(specPath, segments))
    .sort((a, b) => specificity(b.segments).localeCompare(specificity(a.segments)))[0];
}
const operations = Object.entries(spec.paths).flatMap(([specPath, item]) =>
  (["get", "post", "delete", "put", "patch"] as const)
    .filter((method) => item[method])
    .map((method) => ({ specPath, method, operation: item[method] as OperationObject })),
);

describe("OpenAPI document", () => {
  it("is OpenAPI 3.1 with the app name and cookie security", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Test GIS API");
    expect(spec.components?.securitySchemes?.sessionCookie).toMatchObject({ type: "apiKey", in: "cookie" });
    expect(spec.servers).toEqual([{ url: "/", description: "This application" }]);
  });

  it("resolves every $ref", () => {
    const refs = collectRefs(spec);
    expect(refs.length).toBeGreaterThan(50);
    expect(refs.filter((ref) => !ref.startsWith("#/") || resolveRef(ref) === undefined)).toEqual([]);
  });

  it("documents every geodata, health and docs route, with the exported methods", () => {
    const documented = routes.filter(
      ({ segments }) => ["geodata", "up"].includes(segments[0]) || (segments[0] === "api" && segments[1] === "api-docs"),
    );
    expect(documented.length).toBeGreaterThan(10);
    for (const route of documented) {
      const specPaths = Object.keys(spec.paths).filter((specPath) => routeFor(specPath)?.file === route.file);
      expect(specPaths, route.segments.join("/")).not.toEqual([]);

      const source = readFileSync(route.file, "utf8");
      const exported = ["GET", "POST", "DELETE", "PUT", "PATCH"].filter((method) =>
        new RegExp(`export (const|async function) ${method}\\b`).test(source),
      );
      const documentedMethods = new Set(
        operations.filter((entry) => specPaths.includes(entry.specPath)).map((entry) => entry.method.toUpperCase()),
      );
      expect([...documentedMethods].sort(), route.segments.join("/")).toEqual(exported.sort());
    }
  });

  it("only documents paths that exist", () => {
    for (const specPath of Object.keys(spec.paths)) {
      expect(routeFor(specPath), specPath).toBeDefined();
    }
  });

  it("has unique operation ids and declares each templated path parameter", () => {
    const ids = operations.map(({ operation }) => operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const { specPath, method, operation } of operations) {
      const declared = (operation.parameters ?? [])
        .map((parameter) => ("$ref" in parameter ? (resolveRef(parameter.$ref) as ParameterObject) : parameter))
        .filter((parameter) => parameter.in === "path")
        .map((parameter) => parameter.name)
        .sort();
      const templated = [...specPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
      expect(declared, `${method} ${specPath}`).toEqual(templated);
      expect(Object.keys(operation.responses).length, `${method} ${specPath}`).toBeGreaterThan(0);
    }
  });

  it("takes upload limits from the configuration", () => {
    const settings = { ...currentOpenApiSettings(), maxUploadMb: 50, chunkBytes: 1024 * 1024 };
    const schemas = buildOpenApiSpec(settings).components?.schemas ?? {};
    expect(schemas.StartUploadSessionRequest.properties?.fileSize.maximum).toBe(50 * 1024 * 1024);
    expect(schemas.UploadSession.properties?.chunkSize.examples).toEqual([1024 * 1024]);
  });
});
