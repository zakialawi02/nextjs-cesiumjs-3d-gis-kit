import { geodataConfig } from "@/config/geodata";
import { handler, json } from "@/server/http";
import { validateRequest } from "@/server/services/upload/request-validation";
import { storeChunk } from "@/server/services/upload/upload-session-service";

import { readInput, requireUploader } from "../_lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /geodata/upload/chunk (GeodataUploadController::uploadChunk), multipart: `file` (one chunk,
 * at most the 2 MB chunk size), `identifier` (session uuid), `chunkIndex`, `checksum` (sha256 hex).
 */
export const POST = handler(async (request) => {
  const user = await requireUploader("upload-chunks");
  const data = await validateRequest<{ file: Blob; identifier: string; chunkIndex: number; checksum: string }>(await readInput(request), {
    file: ["required", "file", { max: Math.ceil(geodataConfig.upload.chunkBytes / 1024) }],
    identifier: ["required", "uuid"],
    chunkIndex: ["required", "integer", { min: 0 }],
    checksum: ["required", "string", { regex: /^[a-f0-9]{64}$/ }],
  });

  const bytes = Buffer.from(await data.file.arrayBuffer());
  await storeChunk(data.identifier, user.id, bytes, data.chunkIndex, data.checksum);
  return json({ success: true });
});
