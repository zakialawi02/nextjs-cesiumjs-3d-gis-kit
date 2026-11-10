import { describe, expect, it } from "vitest";

import { HttpError } from "@/server/http";
import { attributeName, validateRequest, type RuleSet } from "@/server/services/upload/request-validation";

async function errorsOf(input: Record<string, unknown>, rules: RuleSet): Promise<Record<string, string[]> | undefined> {
  try {
    await validateRequest(input, rules);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(422);
    return (error as HttpError).errors;
  }
}

describe("request validation (Laravel rules and messages)", () => {
  it("derives attribute names like Laravel", () => {
    expect(attributeName("fileName")).toBe("file name");
    expect(attributeName("layer_category_id")).toBe("layer category id");
    expect(attributeName("demIdentifier")).toBe("dem identifier");
  });

  it("validates the session start request", async () => {
    const rules: RuleSet = {
      fileName: ["required", "string", { max: 255 }],
      requestId: ["nullable", "uuid"],
      fileSize: ["required", "integer", { min: 1 }, { max: 1000 }],
    };

    expect(await errorsOf({ fileName: "  ", fileSize: "abc", requestId: "nope" }, rules)).toEqual({
      fileName: ["The file name field is required."],
      requestId: ["The request id field must be a valid UUID."],
      fileSize: ["The file size field must be an integer."],
    });
    expect(await errorsOf({ fileName: "a.tif", fileSize: 0 }, rules)).toEqual({ fileSize: ["The file size field must be at least 1."] });
    expect(await errorsOf({ fileName: "a.tif", fileSize: 1001 }, rules)).toEqual({
      fileSize: ["The file size field must not be greater than 1000."],
    });
    expect(await errorsOf({ fileName: "x".repeat(256), fileSize: 5 }, rules)).toEqual({
      fileName: ["The file name field must not be greater than 255 characters."],
    });

    await expect(validateRequest({ fileName: " dem.tif ", fileSize: "42", requestId: "" }, rules)).resolves.toEqual({
      fileName: "dem.tif",
      fileSize: 42,
      requestId: null,
    });
  });

  it("validates chunk uploads", async () => {
    const rules: RuleSet = {
      file: ["required", "file", { max: 2048 }],
      chunkIndex: ["required", "integer", { min: 0 }],
      checksum: ["required", "string", { regex: /^[a-f0-9]{64}$/ }],
    };

    expect(await errorsOf({ file: "text", chunkIndex: "-1", checksum: "ABC" }, rules)).toEqual({
      file: ["The file field must be a file."],
      chunkIndex: ["The chunk index field must be at least 0."],
      checksum: ["The checksum field format is invalid."],
    });
    expect(await errorsOf({ file: new Blob([new Uint8Array(2049 * 1024)]), chunkIndex: "0", checksum: "a".repeat(64) }, rules)).toEqual({
      file: ["The file field must not be greater than 2048 kilobytes."],
    });
  });

  it("validates completion requests", async () => {
    const rules: RuleSet = {
      layerName: ["required", "string", { max: 255 }],
      sourceEpsg: ["nullable", "string", { regex: /^EPSG:[1-9][0-9]{2,6}$/ }],
      acquisitionDate: ["nullable", { dateFormat: "Y-m-d" }],
      layer_category_id: ["nullable", { exists: async (id) => id === "01JCATEGORY0000000000000000" }],
      demIdentifier: ["required", "uuid"],
      orthoIdentifier: ["nullable", "uuid", { different: "demIdentifier" }],
    };
    const uuid = "6f1c1d36-3b0e-4b7e-9d2a-0c8f2b6c1a11";

    expect(
      await errorsOf(
        { layerName: "Pit", sourceEpsg: "EPSG:0", acquisitionDate: "2026-02-30", layer_category_id: "unknown", demIdentifier: uuid, orthoIdentifier: uuid },
        rules,
      ),
    ).toEqual({
      sourceEpsg: ["The source epsg field format is invalid."],
      acquisitionDate: ["The acquisition date field must match the format Y-m-d."],
      layer_category_id: ["The selected layer category id is invalid."],
      orthoIdentifier: ["The ortho identifier field and dem identifier must be different."],
    });

    await expect(
      validateRequest({ layerName: "Pit", sourceEpsg: "EPSG:32749", acquisitionDate: "", layer_category_id: null, demIdentifier: uuid, extra: 1 }, rules),
    ).resolves.toEqual({
      layerName: "Pit",
      sourceEpsg: "EPSG:32749",
      acquisitionDate: null,
      layer_category_id: null,
      demIdentifier: uuid,
      orthoIdentifier: null,
    });
  });

  it("uses the first error as the response message", async () => {
    await expect(validateRequest({}, { layerName: ["required"] })).rejects.toMatchObject({
      status: 422,
      message: "The layer name field is required.",
    });
  });
});
