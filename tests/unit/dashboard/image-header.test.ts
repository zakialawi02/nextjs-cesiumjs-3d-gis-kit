import { describe, expect, it } from "vitest";

import { iconErrors, readImageInfo } from "@/server/dashboard/image-header";

function bytes(length: number, entries: Array<[offset: number, values: number[] | string]>): Uint8Array {
  const data = new Uint8Array(length);
  for (const [offset, values] of entries) {
    const list = typeof values === "string" ? [...values].map((c) => c.charCodeAt(0)) : values;
    data.set(list, offset);
  }
  return data;
}

function png(width: number, height: number): Uint8Array {
  const data = bytes(33, [
    [0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    [8, [0, 0, 0, 13]],
    [12, "IHDR"],
  ]);
  new DataView(data.buffer).setUint32(16, width);
  new DataView(data.buffer).setUint32(20, height);
  return data;
}

function webp(chunk: string, payload: Array<[number, number[]]>): Uint8Array {
  return bytes(40, [[0, "RIFF"], [8, "WEBP"], [12, chunk], ...payload]);
}

describe("readImageInfo", () => {
  it("reads PNG dimensions from the IHDR chunk", () => {
    expect(readImageInfo(png(64, 48))).toEqual({ type: "png", width: 64, height: 48 });
  });

  it("reads lossy WebP (VP8) dimensions", () => {
    const data = webp("VP8 ", [
      [23, [0x9d, 0x01, 0x2a]],
      [26, [0x00, 0x02]], // 512
      [28, [0x2c, 0x01]], // 300
    ]);
    expect(readImageInfo(data)).toEqual({ type: "webp", width: 512, height: 300 });
  });

  it("reads lossless WebP (VP8L) dimensions", () => {
    const bits = (100 - 1) | ((50 - 1) << 14);
    const data = webp("VP8L", [[20, [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]]]);
    expect(readImageInfo(data)).toEqual({ type: "webp", width: 100, height: 50 });
  });

  it("reads extended WebP (VP8X) canvas dimensions", () => {
    const data = webp("VP8X", [[24, [0xff, 0x01, 0x00, 0x57, 0x02, 0x00]]]);
    expect(readImageInfo(data)).toEqual({ type: "webp", width: 512, height: 600 });
  });

  it.each([
    ["JPEG", bytes(40, [[0, [0xff, 0xd8, 0xff, 0xe0]]])],
    ["SVG text", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')],
    ["truncated PNG", png(10, 10).subarray(0, 20)],
    ["PNG without IHDR", bytes(33, [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], [12, "IDAT"]])],
    ["RIFF that is not WebP", bytes(40, [[0, "RIFF"], [8, "WAVE"]])],
    ["VP8 without start code", webp("VP8 ", [[26, [0x10, 0x00, 0x10, 0x00]]])],
    ["empty file", new Uint8Array()],
  ])("rejects %s", (_label, data) => {
    expect(readImageInfo(data)).toBeNull();
  });
});

describe("iconErrors", () => {
  it("accepts a small PNG", () => {
    expect(iconErrors({ type: "png", width: 512, height: 512 }, 512 * 1024)).toEqual([]);
  });

  it("reports type, size and dimensions with Laravel's messages", () => {
    expect(iconErrors(null, 600 * 1024)).toEqual([
      "The icon field must be a file of type: png, webp.",
      "The icon field must not be greater than 512 kilobytes.",
    ]);
    expect(iconErrors({ type: "webp", width: 513, height: 10 }, 1000)).toEqual(["The icon field has invalid image dimensions."]);
  });
});
