import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { SourceFile, UploadSession } from "@prisma/client";

import { SourceFileStatus } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { storage } from "@/server/storage";
import { fileExtension, hashEquals, sha256File } from "@/server/services/support";
import { detectMimeType, validateUploadedFile } from "@/server/services/upload/upload-file-validator";
import { chunkMap, ensureDiskSpace, sessionDirectory } from "@/server/services/upload/upload-session-service";

/**
 * Stitches a session's verified chunks into its source file on the geodata disk (port of
 * FileAssemblyService). Runs in the worker. Chunks are kept when assembly fails, so a retry
 * starts again from an empty output.
 */
export async function assembleUploadSession(session: UploadSession): Promise<SourceFile> {
  if (!session.source_file_id) throw new Error("Upload session has no source file.");
  const source = await prisma.sourceFile.findUniqueOrThrow({ where: { id: session.source_file_id } });
  const finalPath = storage.path("geodata", source.storage_path);
  const directory = sessionDirectory(session);

  if (source.status === SourceFileStatus.Ready && (await isFile(finalPath))) {
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: "assembled" } });
    await fs.rm(directory, { recursive: true, force: true });
    return source;
  }

  const declaredSize = Number(session.file_size);
  await ensureDiskSpace(declaredSize);
  await fs.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });

  const temporary = `${finalPath}.assembling`;
  let output: fs.FileHandle | null = null;
  try {
    try {
      output = await fs.open(temporary, "w");
    } catch {
      throw new Error("Unable to create assembly output.");
    }

    const chunks = chunkMap(session.chunks);
    const hash = createHash("sha256");
    let bytes = 0;

    for (let index = 0; index < session.total_chunks; index++) {
      const chunkFile = path.join(directory, `${index}.part`);
      const expectedHash = chunks[String(index)];
      if (!(await isFile(chunkFile)) || expectedHash === undefined || !hashEquals(expectedHash, await sha256File(chunkFile))) {
        throw new Error("Missing or corrupted upload chunk.");
      }

      const input = createReadStream(chunkFile, { highWaterMark: 1024 * 1024 });
      const reader = (input as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
      try {
        for (;;) {
          let next: IteratorResult<Buffer>;
          try {
            next = await reader.next();
          } catch {
            throw new Error("Unable to read upload chunk.");
          }
          if (next.done) break;
          const buffer = next.value;
          await writeAll(output, buffer);
          bytes += buffer.length;
          if (bytes > declaredSize) {
            throw new Error("Assembled file exceeds the declared size.");
          }
          hash.update(buffer);
        }
      } finally {
        input.destroy();
      }
    }

    if (bytes !== declaredSize) {
      throw new Error("Assembled file size does not match the upload session.");
    }
    await output.sync();
    await output.close();
    output = null;

    const extension = fileExtension(session.file_name);
    await validateUploadedFile(temporary, extension);
    try {
      await fs.rename(temporary, finalPath);
    } catch {
      throw new Error("Unable to commit assembled file.");
    }

    const updated = await prisma.sourceFile.update({
      where: { id: source.id },
      data: {
        file_size: bytes,
        checksum_sha256: hash.digest("hex"),
        mime_type: await detectMimeType(finalPath, extension),
        status: SourceFileStatus.Ready,
      },
    });
    await prisma.uploadSession.update({ where: { id: session.id }, data: { status: "assembled" } });
    await fs.rm(directory, { recursive: true, force: true });
    return updated;
  } finally {
    if (output) await output.close().catch(() => undefined);
    await fs.rm(temporary, { force: true });
  }
}

async function writeAll(output: fs.FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await output.write(buffer, offset, buffer.length - offset);
    if (bytesWritten === 0) throw new Error("Unable to write assembled file.");
    offset += bytesWritten;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}
