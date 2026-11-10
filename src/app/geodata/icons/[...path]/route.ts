import { isMissingFileError } from "@/app/geodata/terrain/published-layer";
import { ICON_PATH_PATTERN } from "@/server/geodata/presenters";
import { requireApiUser } from "@/server/auth";
import { abort, handler } from "@/server/http";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * GET /geodata/icons/layer-categories/<name>.(png|webp) (IconController::show): uploaded category
 * icons, served to signed-in users from icons/ on the public disk without exposing the rest of it.
 */
export const GET = handler<{ path: string[] }>(async (_request, { params }) => {
  const { path } = await params;
  const iconPath = path.join("/");
  if (!ICON_PATH_PATTERN.test(iconPath)) abort(404);

  await requireApiUser();

  let file: Buffer;
  try {
    file = await storage.read("public", `icons/${iconPath}`);
  } catch (error) {
    if (isMissingFileError(error)) abort(404);
    throw error;
  }

  return new Response(new Uint8Array(file), {
    status: 200,
    headers: {
      "Content-Type": iconPath.endsWith(".webp") ? "image/webp" : "image/png",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
