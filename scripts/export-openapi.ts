/**
 * Writes the OpenAPI document to docs/openapi.json (npm run openapi:export). Limits in the
 * document come from the current .env, like the live /api/api-docs/openapi.json.
 */
import "../src/server/load-env";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildOpenApiSpec } from "../src/server/openapi/spec";

async function main() {
  const target = path.join(process.cwd(), "docs", "openapi.json");
  const spec = buildOpenApiSpec();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), target)} (${Object.keys(spec.paths).length} paths).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
