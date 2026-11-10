import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Prisma, UploadSession } from "@prisma/client";

import { geodataConfig } from "@/config/geodata";
import { prisma } from "@/lib/prisma";
import { abort, abortIf, abortUnless, validationError } from "@/server/http";
import { DISK_ROOTS, freeDiskBytes, storage } from "@/server/storage";
import { fileExtension, hashEquals, isUuid, toIso8601String } from "@/server/services/support";

/**
 * Chunked upload sessions (port of UploadSessionService): quotas, idempotent session creation,
 * chunk bookkeeping and cancellation. Chunks live in storage/app/private/temp_chunks/<session id>.
 */
type Db = Prisma.TransactionClient | typeof prisma;

const MB = 1024 * 1024;
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

export type UploadSessionStatus = "uploading" | "queued" | "assembled" | "failed" | "cancelled";

/** Chunk checksums keyed by chunk index ("0", "1", ...). Accepts a JSON list as well. */
export function chunkMap(chunks: Prisma.JsonValue): Record<string, string> {
  const map: Record<string, string> = {};
  if (Array.isArray(chunks)) {
    chunks.forEach((hash, index) => {
      if (typeof hash === "string") map[String(index)] = hash;
    });
  } else if (chunks && typeof chunks === "object") {
    for (const [index, hash] of Object.entries(chunks)) {
      if (typeof hash === "string" && /^\d+$/.test(index)) map[String(Number(index))] = hash;
    }
  }
  return map;
}

/** JSON shape the browser upload client expects (GeodataUploadController::sessionData). */
export function presentUploadSession(session: UploadSession) {
  return {
    identifier: session.id,
    fileName: session.file_name,
    fileSize: Number(session.file_size),
    chunkSize: session.chunk_size,
    totalChunks: session.total_chunks,
    chunks: chunkMap(session.chunks),
    status: session.status,
    job_id: session.conversion_job_id,
    expiresAt: toIso8601String(session.expires_at),
  };
}

function expiresAt(): Date {
  return new Date(Date.now() + geodataConfig.upload.sessionHours * 3600 * 1000);
}

function isPast(date: Date): boolean {
  return date.getTime() < Date.now();
}

/** Absolute directory of a session's chunks. */
export function sessionDirectory(session: Pick<UploadSession, "id"> | string): string {
  const id = typeof session === "string" ? session : session.id;
  abortUnless(isUuid(id), 404);
  return storage.path("local", `temp_chunks/${id}`);
}

export function chunkPath(session: Pick<UploadSession, "id">, index: number): string {
  return path.join(sessionDirectory(session), `${index}.part`);
}

/** 507 unless the geodata volume keeps GEODATA_MIN_FREE_DISK_MB free after `additionalBytes`. */
export async function ensureDiskSpace(additionalBytes: number): Promise<void> {
  await fs.mkdir(DISK_ROOTS.geodata, { recursive: true, mode: 0o700 });
  let free: number | null = null;
  try {
    free = await freeDiskBytes();
  } catch {
    free = null;
  }
  abortIf(
    free === null || free < additionalBytes + geodataConfig.upload.minFreeDiskMb * MB,
    507,
    "Insufficient storage space.",
  );
}

export function validateFileName(fileName: string): void {
  const extension = fileExtension(fileName).toLowerCase();
  if (
    Buffer.byteLength(fileName, "utf8") > 255 ||
    /[\x00-\x1f\x7f<>:"/\\|?*]/.test(fileName) ||
    !(geodataConfig.allowedExtensions as readonly string[]).includes(extension)
  ) {
    validationError({ fileName: "Unsupported format or unsafe file name." });
  }
}

/** The user's session `id` (404 otherwise), optionally locked FOR UPDATE inside a transaction. */
export async function findOwnedSession(db: Db, id: string, userId: string, lock = false): Promise<UploadSession> {
  abortUnless(isUuid(id), 404);
  if (lock) {
    await db.$queryRaw`SELECT id FROM upload_sessions WHERE id = ${id}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
  }
  const session = await db.uploadSession.findFirst({ where: { id, user_id: userId } });
  if (!session) abort(404);
  return session;
}

export async function startUploadSession(
  userId: string,
  fileName: string,
  fileSize: number,
  requestId?: string | null,
): Promise<UploadSession> {
  validateFileName(fileName);
  if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > geodataConfig.maxUploadMb * MB) {
    validationError({ fileSize: "The file exceeds the upload limit or is empty." });
  }

  const request = requestId ?? randomUUID();
  abortUnless(isUuid(request), 422, "Invalid upload request ID.");

  return prisma.$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (users.length === 0) abort(404);

    const existing = await tx.uploadSession.findFirst({ where: { user_id: userId, request_id: request } });
    if (existing) {
      abortUnless(
        existing.file_name === fileName && Number(existing.file_size) === fileSize,
        409,
        "Upload request ID was used for a different file.",
      );
      abortIf(isPast(existing.expires_at), 410, "Upload expired.");
      return existing;
    }

    const active: Prisma.UploadSessionWhereInput = {
      user_id: userId,
      status: { in: ["uploading", "queued"] },
      OR: [{ expires_at: { gt: new Date() } }, { status: "queued" }],
    };
    const activeCount = await tx.uploadSession.count({ where: active });
    abortIf(
      activeCount >= geodataConfig.upload.maxActiveSessions,
      429,
      "Too many active uploads. Cancel an upload before starting another.",
    );
    const inflight = await tx.uploadSession.aggregate({ where: active, _sum: { file_size: true } });
    abortIf(
      Number(inflight._sum.file_size ?? 0) + fileSize > geodataConfig.upload.maxInflightMb * MB,
      413,
      "Your active uploads exceed the storage quota.",
    );
    await ensureDiskSpace(fileSize * 2);

    const chunkSize = geodataConfig.upload.chunkBytes;
    return tx.uploadSession.create({
      data: {
        user_id: userId,
        request_id: request,
        file_name: fileName,
        file_size: fileSize,
        chunk_size: chunkSize,
        total_chunks: Math.ceil(fileSize / chunkSize),
        chunks: {},
        status: "uploading",
        expires_at: expiresAt(),
      },
    });
  }, TRANSACTION_OPTIONS);
}

export function assertWritable(session: UploadSession): void {
  abortUnless(session.status === "uploading", 409, "This upload is no longer writable.");
  abortIf(isPast(session.expires_at), 410, "This upload expired. Please select the file again.");
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function assertComplete(session: UploadSession): Promise<void> {
  assertWritable(session);
  const chunks = chunkMap(session.chunks);
  abortUnless(Object.keys(chunks).length === session.total_chunks, 409, "Upload is incomplete. Resume the missing chunks.");
  for (let index = 0; index < session.total_chunks; index++) {
    abortUnless(chunks[String(index)] !== undefined && (await isFile(chunkPath(session, index))), 409, "A required chunk is missing.");
  }
}

export async function storeChunk(id: string, userId: string, bytes: Buffer, index: number, checksum: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await findOwnedSession(tx, id, userId, true);
    assertWritable(session);
    abortIf(index < 0 || index >= session.total_chunks, 422, "Chunk index is out of range.");
    const fileSize = Number(session.file_size);
    const expected = Math.min(session.chunk_size, fileSize - index * session.chunk_size);
    abortUnless(bytes.length === expected, 422, "Chunk size does not match the upload session.");
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    abortUnless(hashEquals(checksum, actualHash), 422, "Chunk checksum mismatch.");

    const chunks = chunkMap(session.chunks);
    const existing = chunks[String(index)];
    if (existing !== undefined) {
      abortUnless(hashEquals(existing, actualHash), 409, "A different chunk already exists at this index.");
    }
    await ensureDiskSpace(expected);

    const directory = sessionDirectory(session);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(directory, `${index}.${randomBytes(8).toString("hex")}.tmp`);
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx" });
      try {
        await fs.rename(temporary, path.join(directory, `${index}.part`));
      } catch {
        throw new Error("Unable to persist upload chunk.");
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }

    chunks[String(index)] = actualHash;
    await tx.uploadSession.update({ where: { id: session.id }, data: { chunks, expires_at: expiresAt() } });
  }, TRANSACTION_OPTIONS);
}

export async function cancelUploadSession(id: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await findOwnedSession(tx, id, userId, true);
    abortUnless(["uploading", "cancelled"].includes(session.status), 409, "Processing has already started.");
    await fs.rm(sessionDirectory(session), { recursive: true, force: true });
    await tx.uploadSession.update({ where: { id: session.id }, data: { status: "cancelled", chunks: {} } });
  }, TRANSACTION_OPTIONS);
}
