import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { json } from "@/server/http";
import { completeUpload, type CompletionData, type CompletionType } from "@/server/services/upload/upload-completion-service";
import { validateRequest, type RuleSet } from "@/server/services/upload/request-validation";

import { readInput, requireUploader } from "./guard";

async function categoryExists(id: string): Promise<boolean> {
  return (await prisma.layerCategory.count({ where: { id } })) > 0;
}

/** GeodataUploadController::completionRules() */
export const completionRules: RuleSet = {
  layerName: ["required", "string", { max: 255 }],
  sourceEpsg: ["nullable", "string", { regex: /^EPSG:[1-9][0-9]{2,6}$/ }],
  acquisitionDate: ["nullable", { dateFormat: "Y-m-d" }],
  layer_category_id: ["nullable", { exists: categoryExists }],
};

/** Validates, completes the upload and answers 202 with the queued conversion job id. */
export async function queueCompletion(request: NextRequest, rules: RuleSet, type: CompletionType): Promise<Response> {
  const user = await requireUploader("upload-start");
  const data = await validateRequest<CompletionData>(await readInput(request), { ...completionRules, ...rules });
  const job = await completeUpload(data, type, user.id);
  return json({ success: true, message: "Upload queued for verification and processing.", job_id: job.id }, 202);
}
