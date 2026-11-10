import fs from "node:fs/promises";

/**
 * Streams a GeoJSON FeatureCollection, keeping at most one feature in memory (port of
 * GeoJsonFeatureReader). The root object is scanned byte by byte; each element of the top-level
 * `features` array is decoded on its own, and the remaining root members are validated at the end
 * with the features array replaced by `[]`.
 */
export type GeoJsonGeometry = { type?: unknown; coordinates?: unknown; [key: string]: unknown };
export type GeoJsonFeature = {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
  [key: string]: unknown;
};

/** Invalid JSON syntax (PHP's JsonException from json_decode(..., JSON_THROW_ON_ERROR)). */
export class JsonException extends Error {}

const MAX_FEATURE_BYTES = 16 * 1024 * 1024;
const MAX_ROOT_BYTES = 1024 * 1024;
/** json_decode($json, true, 128) */
const MAX_DEPTH = 128;
const BLOCK_SIZE = 65536;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** ctype_space() / PCRE \s */
function isSpace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

function decodeJson(bytes: Uint8Array, maxDepth: number): unknown {
  if (maxDepth > MAX_DEPTH) throw new JsonException("Maximum stack depth exceeded");
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new JsonException("Malformed UTF-8 characters, possibly incorrectly encoded");
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new JsonException(error instanceof Error ? error.message : "Syntax error");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Ends with `"features"\s*:\s*[` (the PHP regex `/"features"\s*:\s*\[$/s`). */
function endsWithFeaturesKey(buffer: Buffer, length: number): boolean {
  let i = length - 1;
  if (i < 0 || buffer[i] !== OPEN_BRACKET) return false;
  i--;
  while (i >= 0 && isSpace(buffer[i])) i--;
  if (i < 0 || buffer[i] !== COLON) return false;
  i--;
  while (i >= 0 && isSpace(buffer[i])) i--;
  const key = '"features"';
  if (i + 1 < key.length) return false;
  return buffer.toString("latin1", i + 1 - key.length, i + 1) === key;
}

export async function* readGeoJsonFeatures(filePath: string): AsyncGenerator<GeoJsonFeature> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch {
    throw new Error("Unable to read GeoJSON.");
  }

  try {
    const root = Buffer.alloc(MAX_ROOT_BYTES + 2);
    let rootLength = 0;
    let depth = 0;
    let rootMaxDepth = 0;
    let inString = false;
    let escaped = false;
    let foundFeatures = false;
    let inFeatures = false;
    let featureParts: Buffer[] = [];
    let featureLength = 0;
    let featureDepth = 0;
    let featureMaxDepth = 0;
    let expectFeature = true;
    let afterFeature = false;
    let hasFeature = false;
    const block = Buffer.alloc(BLOCK_SIZE);

    for (;;) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await handle.read(block, 0, BLOCK_SIZE, null));
      } catch {
        throw new Error("Unable to read GeoJSON.");
      }
      if (bytesRead === 0) break;

      // Start offset (in this block) of the feature being collected, or -1.
      let featureStart = inFeatures && featureDepth > 0 ? 0 : -1;

      for (let i = 0; i < bytesRead; i++) {
        const byte = block[i];

        if (inFeatures) {
          if (featureDepth === 0) {
            if (isSpace(byte)) continue;
            if (byte === CLOSE_BRACKET && !afterFeature) {
              if (hasFeature) throw new Error("Trailing comma in GeoJSON features.");
              inFeatures = false;
              depth--;
              continue;
            }
            if (byte === COMMA && afterFeature) {
              afterFeature = false;
              expectFeature = true;
              continue;
            }
            if (byte === CLOSE_BRACKET && afterFeature) {
              inFeatures = false;
              depth--;
              continue;
            }
            if (byte !== OPEN_BRACE || !expectFeature || afterFeature) {
              throw new Error("Invalid GeoJSON feature list.");
            }
            featureParts = [];
            featureStart = i;
            featureLength = 1;
            featureDepth = 1;
            featureMaxDepth = 1;
            inString = false;
            escaped = false;
            expectFeature = false;
            continue;
          }

          featureLength++;
          if (featureLength > MAX_FEATURE_BYTES) {
            throw new Error("A GeoJSON feature exceeds the 16 MiB processing limit.");
          }
          if (inString) {
            if (escaped) escaped = false;
            else if (byte === BACKSLASH) escaped = true;
            else if (byte === QUOTE) inString = false;
          } else if (byte === QUOTE) {
            inString = true;
          } else if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
            featureDepth++;
            if (featureDepth > featureMaxDepth) featureMaxDepth = featureDepth;
          } else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
            featureDepth--;
          }

          if (featureDepth === 0) {
            featureParts.push(block.subarray(featureStart, i + 1));
            const decoded = decodeJson(Buffer.concat(featureParts), featureMaxDepth);
            featureParts = [];
            featureStart = -1;

            if (!isObject(decoded) || Array.isArray(decoded) || decoded.type !== "Feature" || !Object.hasOwn(decoded, "geometry")) {
              throw new Error("Invalid GeoJSON feature.");
            }
            const geometry = decoded.geometry;
            const properties = decoded.properties;
            if ((geometry !== null && !isObject(geometry)) || (properties !== undefined && properties !== null && !isObject(properties))) {
              throw new Error("Invalid GeoJSON geometry or properties.");
            }
            yield decoded as GeoJsonFeature;
            afterFeature = true;
            hasFeature = true;
          }
          continue;
        }

        root[rootLength++] = byte;
        if (rootLength > MAX_ROOT_BYTES) {
          throw new Error("GeoJSON root metadata exceeds the processing limit.");
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (byte === BACKSLASH) escaped = true;
          else if (byte === QUOTE) inString = false;
          continue;
        }
        if (byte === QUOTE) {
          inString = true;
        } else if (byte === OPEN_BRACE || byte === OPEN_BRACKET) {
          depth++;
          if (depth > rootMaxDepth) rootMaxDepth = depth;
          if (depth === 2 && byte === OPEN_BRACKET && endsWithFeaturesKey(root, rootLength)) {
            if (foundFeatures) throw new Error("Duplicate GeoJSON features array.");
            foundFeatures = true;
            inFeatures = true;
            // The streamed array is replaced by [] for the final root validation.
            root[rootLength++] = CLOSE_BRACKET;
          }
        } else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
          depth--;
        }
      }

      if (featureStart >= 0 && inFeatures && featureDepth > 0) {
        featureParts.push(Buffer.from(block.subarray(featureStart, bytesRead)));
      }
    }

    const decodedRoot = decodeJson(root.subarray(0, rootLength), rootMaxDepth);
    if (
      inFeatures ||
      featureDepth !== 0 ||
      !foundFeatures ||
      depth !== 0 ||
      !isObject(decodedRoot) ||
      Array.isArray(decodedRoot) ||
      decodedRoot.type !== "FeatureCollection" ||
      !Array.isArray(decodedRoot.features)
    ) {
      throw new Error("Expected a valid GeoJSON FeatureCollection.");
    }
  } finally {
    await handle.close();
  }
}

/** Reads a whole (small) document; used by tests and diagnostics. */
export async function collectGeoJsonFeatures(filePath: string): Promise<GeoJsonFeature[]> {
  const features: GeoJsonFeature[] = [];
  for await (const feature of readGeoJsonFeatures(filePath)) features.push(feature);
  return features;
}
