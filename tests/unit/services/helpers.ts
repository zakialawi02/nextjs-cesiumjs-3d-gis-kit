import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

/** Port of the Pest helper `temporaryFileWith()`: files are removed after the test file runs. */
const directory = mkdtempSync(path.join(os.tmpdir(), "gis-unit-"));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

export function temporaryPath(extension = ""): string {
  return path.join(directory, `${randomBytes(8).toString("hex")}${extension}`);
}

export function temporaryFileWith(contents: string | Uint8Array, extension = ""): string {
  const filePath = temporaryPath(extension);
  writeFileSync(filePath, typeof contents === "string" ? Buffer.from(contents, "latin1") : contents);
  return filePath;
}

export function temporaryUtf8FileWith(contents: string, extension = ""): string {
  const filePath = temporaryPath(extension);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}
