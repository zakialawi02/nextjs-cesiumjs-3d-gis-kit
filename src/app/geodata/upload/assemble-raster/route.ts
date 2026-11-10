import { LayerType } from "@/lib/enums";
import { handler } from "@/server/http";

import { queueCompletion } from "../_lib/completion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /geodata/upload/assemble-raster (GeodataUploadController::assembleRaster): completes a DEM
 * upload (plus an optional orthophoto) and queues the terrain conversion. 202 `{ success, message, job_id }`.
 */
export const POST = handler((request) =>
  queueCompletion(
    request,
    {
      demIdentifier: ["required", "uuid"],
      orthoIdentifier: ["nullable", "uuid", { different: "demIdentifier" }],
    },
    LayerType.Terrain,
  ),
);
