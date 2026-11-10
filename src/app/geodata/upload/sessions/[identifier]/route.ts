import { prisma } from "@/lib/prisma";
import { abortIf, handler, json } from "@/server/http";
import { cancelUploadSession, findOwnedSession, presentUploadSession } from "@/server/services/upload/upload-session-service";

import { requireUploader } from "../../_lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { identifier: string };

/**
 * GET /geodata/upload/sessions/{identifier} (GeodataUploadController::session): the session's
 * state for resuming; 410 once an unfinished upload expired.
 */
export const GET = handler<Params>(async (_request, { params }) => {
  const user = await requireUploader("upload-status");
  const { identifier } = await params;
  const session = await findOwnedSession(prisma, identifier, user.id);
  abortIf(session.expires_at.getTime() < Date.now() && session.status === "uploading", 410, "Upload expired.");

  return json({ success: true, session: presentUploadSession(session) }, { headers: { "Cache-Control": "no-store" } });
});

/**
 * DELETE /geodata/upload/sessions/{identifier} (GeodataUploadController::cancel): cancels an
 * upload that has not been submitted for processing and removes its chunks.
 */
export const DELETE = handler<Params>(async (_request, { params }) => {
  const user = await requireUploader("upload-start");
  const { identifier } = await params;
  await cancelUploadSession(identifier, user.id);
  return json({ success: true });
});
