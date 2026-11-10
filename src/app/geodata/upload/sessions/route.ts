import { geodataConfig } from "@/config/geodata";
import { handler, json } from "@/server/http";
import { validateRequest } from "@/server/services/upload/request-validation";
import { presentUploadSession, startUploadSession } from "@/server/services/upload/upload-session-service";

import { readInput, requireUploader } from "../_lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /geodata/upload/sessions (GeodataUploadController::start): starts, or resumes by
 * `requestId`, a chunked upload session. 201 `{ success, session }`.
 */
export const POST = handler(async (request) => {
  const user = await requireUploader("upload-start");
  const data = await validateRequest<{ fileName: string; requestId: string | null; fileSize: number }>(await readInput(request), {
    fileName: ["required", "string", { max: 255 }],
    requestId: ["nullable", "uuid"],
    fileSize: ["required", "integer", { min: 1 }, { max: geodataConfig.maxUploadMb * 1024 * 1024 }],
  });

  const session = await startUploadSession(user.id, data.fileName, data.fileSize, data.requestId ?? null);
  return json({ success: true, session: presentUploadSession(session) }, 201);
});
