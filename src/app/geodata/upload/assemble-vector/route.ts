import { LayerType } from "@/lib/enums";
import { handler } from "@/server/http";

import { queueCompletion } from "../_lib/completion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /geodata/upload/assemble-vector (GeodataUploadController::assembleVector): completes a vector
 * upload and queues its import. 202 `{ success, message, job_id }`.
 */
export const POST = handler((request) => queueCompletion(request, { identifier: ["required", "uuid"] }, LayerType.Vector));
