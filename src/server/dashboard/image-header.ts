/**
 * Detects PNG and WebP images from their header bytes and reads the pixel dimensions, so category
 * icons are checked by their real content (Laravel's `mimes:png,webp` + `dimensions` rules) without
 * an image library.
 */
export type ImageInfo = { type: "png" | "webp"; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  // The first chunk must be IHDR: 4-byte length, "IHDR", then width and height (big-endian).
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { type: "png", width, height } : null;
}

function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;

  let width = 0;
  let height = 0;

  switch (ascii(bytes, 12, 4)) {
    case "VP8 ": {
      // Lossy: 3-byte frame tag, start code 9d 01 2a, then 14-bit width and height (little-endian).
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
      height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
      break;
    }
    case "VP8L": {
      // Lossless: signature 0x2f, then 14 bits (width - 1) and 14 bits (height - 1).
      if (bytes[20] !== 0x2f) return null;
      const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      break;
    }
    case "VP8X": {
      // Extended: 24-bit (canvas width - 1) and (canvas height - 1) after flags and reserved bytes.
      width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      break;
    }
    default:
      return null;
  }

  return width > 0 && height > 0 ? { type: "webp", width, height } : null;
}

/** The image type and size when `bytes` start with a PNG or WebP header, otherwise null. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readWebp(bytes);
}

export const ICON_MAX_BYTES = 512 * 1024;
export const ICON_MAX_DIMENSION = 512;

/**
 * Laravel messages for `icon => nullable|file|mimes:png,webp|max:512|dimensions:max_width=512,max_height=512`.
 * A file that is not PNG/WebP only gets the type message (its dimensions cannot be read).
 */
export function iconErrors(info: ImageInfo | null, size: number): string[] {
  const errors: string[] = [];
  if (!info) errors.push("The icon field must be a file of type: png, webp.");
  if (size > ICON_MAX_BYTES) errors.push("The icon field must not be greater than 512 kilobytes.");
  if (info && (info.width > ICON_MAX_DIMENSION || info.height > ICON_MAX_DIMENSION)) {
    errors.push("The icon field has invalid image dimensions.");
  }
  return errors;
}
