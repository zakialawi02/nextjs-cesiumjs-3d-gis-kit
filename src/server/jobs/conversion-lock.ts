import { pgPool } from "@/server/db/pg";

/**
 * Per-conversion mutex (Laravel: WithoutOverlapping('geodata:'.$id)->shared()): a session-level
 * Postgres advisory lock held on a dedicated connection while `callback` runs. It is released
 * when the callback settles, or by Postgres if the worker dies.
 */
export type LockedResult<T> = { acquired: true; result: T } | { acquired: false };

export async function withConversionLock<T>(conversionJobId: string, callback: () => Promise<T>): Promise<LockedResult<T>> {
  const key = `geodata:${conversionJobId}`;
  const client = await pgPool.connect();
  let acquired = false;
  let releaseError: Error | undefined;
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [key]);
    acquired = rows[0]?.locked === true;
    if (!acquired) return { acquired: false };
    return { acquired: true, result: await callback() };
  } finally {
    if (acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [key]);
      } catch (error) {
        // Destroying the connection releases the lock as well.
        releaseError = error instanceof Error ? error : new Error(String(error));
      }
    }
    client.release(releaseError);
  }
}
