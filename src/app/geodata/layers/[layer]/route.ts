import { UserRole } from "@/lib/enums";
import { requireApiUser } from "@/server/auth";
import { abort, handler, json } from "@/server/http";
import { deleteLayer, dispatchLayerCleanup } from "@/server/services/layers/layer-deletion-service";
import { isUlid } from "@/server/services/support";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /geodata/layers/{layer} (GeodataController::destroy, admin only): deletes a layer with
 * its job, logs, upload sessions and source files, then queues removal of its tiles, files and
 * PostGIS table. 409 while its conversion is queued / processing (unless idle for over 3 hours).
 */
export const DELETE = handler<{ layer: string }>(async (_request, { params }) => {
  await requireApiUser(UserRole.Admin);
  const { layer: layerId } = await params;
  if (!isUlid(layerId)) abort(404);

  const result = await deleteLayer(layerId);
  if (result.status === "not_found") abort(404);
  if (result.status === "running") {
    return json(
      {
        success: false,
        message: "This layer is still being processed. Wait until its conversion finishes or fails before deleting it.",
      },
      409,
    );
  }

  await dispatchLayerCleanup(result.cleanup);
  return json({ success: true, message: "Layer deleted." });
});
