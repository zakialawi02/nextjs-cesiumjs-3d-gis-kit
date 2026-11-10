import { requireApiUser } from "@/server/auth";
import { handler, json } from "@/server/http";
import { buildOpenApiSpec } from "@/server/openapi/spec";

export const dynamic = "force-dynamic";

/** GET /api/api-docs/openapi.json: the OpenAPI 3.1 document of the HTTP API, for signed-in users. */
export const GET = handler(async () => {
  await requireApiUser();
  return json(buildOpenApiSpec(), { headers: { "Cache-Control": "no-store" } });
});
