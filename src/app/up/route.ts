import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Health check (Laravel's /up): 200 when the app can reach the database.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "up" });
  } catch {
    return Response.json({ status: "down" }, { status: 503 });
  }
}
