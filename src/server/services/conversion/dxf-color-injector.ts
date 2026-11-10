import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { geodataConfig } from "@/config/geodata";
import { logChannel } from "@/server/logger";
import { PROJECT_ROOT } from "@/server/services/conversion/docker";
import { runProcess } from "@/server/services/process";
import { errorMessage, phpInt } from "@/server/services/support";

/**
 * Adds the colours ogr2ogr drops to a GeoJSON converted from DXF (port of DxfColorInjector): maps
 * each entity handle of the original DXF to its colour and sets `RawColor` (hex) and `AciColor`
 * on the matching feature (`EntityHandle` property). Uses parse_dxf_colors.py (ezdxf) when
 * GEODATA_ENABLE_PYTHON_COLOR_PARSER is on, otherwise the built-in group-code parser.
 */
const logger = logChannel("vector_conversion");

/** Standard AutoCAD Color Index → CSS hex. */
const ACI_TO_HEX: readonly string[] = [
  "#000000", "#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#FF00FF", "#FFFFFF", "#414141", "#808080",
  "#FF0000", "#FFAAAA", "#BD0000", "#BD7E7E", "#810000", "#815656", "#680000", "#684545", "#4F0000", "#4F3535",
  "#FF3F00", "#FFBFAA", "#BD2E00", "#BD8D7E", "#811F00", "#816056", "#681900", "#684E45", "#4F1300", "#4F3B35",
  "#FF7F00", "#FFD4AA", "#BD5E00", "#BD9D7E", "#814000", "#816B56", "#683400", "#685645", "#4F2700", "#4F4235",
  "#FFBF00", "#FFEAAA", "#BD8D00", "#BDAD7E", "#816000", "#817656", "#684E00", "#685F45", "#4F3B00", "#4F4935",
  "#FFFF00", "#FFFFAA", "#BDBD00", "#BDBD7E", "#818100", "#818156", "#686800", "#686845", "#4F4F00", "#4F4F35",
  "#BFFF00", "#EAFFAA", "#8DBD00", "#ADBD7E", "#608100", "#768156", "#4E6800", "#5F6845", "#3B4F00", "#494F35",
  "#7FFF00", "#D4FFAA", "#5EBD00", "#9DBD7E", "#408100", "#6B8156", "#346800", "#566845", "#274F00", "#424F35",
  "#3FFF00", "#BFFFAA", "#2EBD00", "#8DBD7E", "#1F8100", "#608156", "#196800", "#4E6845", "#134F00", "#3B4F35",
  "#00FF00", "#AAFFAA", "#00BD00", "#7EBD7E", "#008100", "#568156", "#006800", "#456845", "#004F00", "#354F35",
  "#00FF3F", "#AAFFBF", "#00BD2E", "#7EBD8D", "#00811F", "#568160", "#006819", "#45684E", "#004F13", "#354F3B",
  "#00FF7F", "#AAFFD4", "#00BD5E", "#7EBD9D", "#008140", "#56816B", "#006834", "#456856", "#004F27", "#354F42",
  "#00FFBF", "#AAFFEA", "#00BD8D", "#7EBDAD", "#008160", "#568176", "#00684E", "#45685F", "#004F3B", "#354F49",
  "#00FFFF", "#AAFFFF", "#00BDBD", "#7EBDBD", "#008181", "#568181", "#006868", "#456868", "#004F4F", "#354F4F",
  "#00BFFF", "#AAEAFF", "#008DBD", "#7EADBD", "#006081", "#567681", "#004E68", "#455F68", "#003B4F", "#35494F",
  "#007FFF", "#AAD4FF", "#005EBD", "#7E9DBD", "#004081", "#566B81", "#003468", "#455668", "#00274F", "#35424F",
  "#003FFF", "#AABFFF", "#002EBD", "#7E8DBD", "#001F81", "#566081", "#001968", "#454E68", "#00134F", "#353B4F",
  "#0000FF", "#AAAAFF", "#0000BD", "#7E7EBD", "#000081", "#565681", "#000068", "#454568", "#00004F", "#35354F",
  "#3F00FF", "#BFAAFF", "#2E00BD", "#8D7EBD", "#1F0081", "#605681", "#190068", "#4E4568", "#13004F", "#3B354F",
  "#7F00FF", "#D4AAFF", "#5E00BD", "#9D7EBD", "#400081", "#6B5681", "#340068", "#564568", "#27004F", "#42354F",
  "#BF00FF", "#EAAAFF", "#8D00BD", "#AD7EBD", "#600081", "#765681", "#4E0068", "#5F4568", "#3B004F", "#49354F",
  "#FF00FF", "#FFAAFF", "#BD00BD", "#BD7EBD", "#810081", "#815681", "#680068", "#684568", "#4F004F", "#4F354F",
  "#FF00BF", "#FFAAEA", "#BD008D", "#BD7EAD", "#810060", "#815676", "#68004E", "#68455F", "#4F003B", "#4F3549",
  "#FF007F", "#FFAAD4", "#BD005E", "#BD7E9D", "#810040", "#81566B", "#680034", "#684556", "#4F0027", "#4F3542",
  "#FF003F", "#FFAABF", "#BD002E", "#BD7E8D", "#81001F", "#815660", "#680019", "#68454E", "#4F0013", "#4F353B",
  "#333333", "#505050", "#696969", "#828282", "#BEBEBE", "#FFFFFF",
];

const ENTITY_TYPES = new Set([
  "LINE", "LWPOLYLINE", "POLYLINE", "POINT", "CIRCLE", "ARC", "ELLIPSE", "SPLINE", "INSERT", "TEXT", "MTEXT", "SOLID",
  "TRACE", "HATCH", "3DFACE", "3DSOLID", "ATTRIB", "ATTDEF", "DIMENSION", "LEADER", "MLINE", "REGION", "BODY", "SHAPE",
]);

const MAX_DXF_BYTES = 4 * 1024 * 1024;
const MAX_GEOJSON_BYTES = 8 * 1024 * 1024;

export type LayerColor = { aci: number | null; trueColor: number | null };
export type EntityData = { color: number | null; trueColor: number | null; layer: string | null };

/** Hex colour of an ACI colour code (0-255), or null. */
export function aciToHex(aciColor: number): string | null {
  return Number.isInteger(aciColor) ? (ACI_TO_HEX[aciColor] ?? null) : null;
}

/** 24-bit DXF true colour → "#RRGGBB". */
export function trueColorToHex(trueColor: number): string {
  return `#${(trueColor & 0xffffff).toString(16).toUpperCase().padStart(6, "0")}`;
}

/**
 * Display colour of an entity: true colour, explicit ACI (1-255), then BYLAYER / BYBLOCK resolved
 * through the layer (true colour, then |ACI|), else white.
 */
export function resolveEntityColor(entity: EntityData, layers: Record<string, LayerColor>): string {
  if (entity.trueColor !== null) return trueColorToHex(entity.trueColor);
  const aci = entity.color;
  if (aci !== null && aci >= 1 && aci <= 255) return ACI_TO_HEX[aci] ?? "#FFFFFF";
  const layer = layers[entity.layer ?? "0"];
  if (layer) {
    if (layer.trueColor !== null) return trueColorToHex(layer.trueColor);
    if (layer.aci !== null) return ACI_TO_HEX[Math.abs(layer.aci)] ?? "#FFFFFF";
  }
  return "#FFFFFF";
}

/** ACI code behind the resolved colour, or null when a true colour (or nothing) decided it. */
export function resolveEntityAci(entity: EntityData, layers: Record<string, LayerColor>): number | null {
  if (entity.trueColor !== null) return null;
  const aci = entity.color;
  if (aci !== null && aci >= 1 && aci <= 255) return aci;
  const layer = layers[entity.layer ?? "0"];
  if (layer) {
    if (layer.trueColor !== null) return null;
    if (layer.aci !== null) return Math.abs(layer.aci);
  }
  return null;
}

/** Group code / value pairs of an ASCII DXF: [code, value] per two lines, both trimmed. */
function* groupPairs(content: string): Generator<[string, string]> {
  const lines = content.split("\n");
  for (let i = 0; i + 1 < lines.length; i += 2) {
    yield [lines[i].trim(), lines[i + 1].trim()];
  }
}

/** LAYER table of the TABLES section: layer name → ACI (group 62) and true colour (420). */
export function parseDxfLayerColors(content: string): Record<string, LayerColor> {
  const map: Record<string, LayerColor> = Object.create(null);
  let inTables = false;
  let inLayerTable = false;
  let parsingLayer = false;
  let name: string | null = null;
  let aci: string | null = null;
  let trueColor: string | null = null;

  const save = () => {
    if (parsingLayer && name !== null) {
      map[name] = { aci: aci !== null ? phpInt(aci) : null, trueColor: trueColor !== null ? phpInt(trueColor) : null };
    }
  };

  for (const [code, value] of groupPairs(content)) {
    if (code === "2" && value === "TABLES") {
      inTables = true;
      continue;
    }
    if (inTables && code === "2" && (value === "ENTITIES" || value === "BLOCKS" || value === "OBJECTS")) {
      save();
      break;
    }
    if (!inTables) continue;
    if (code === "2" && value === "LAYER") {
      inLayerTable = true;
      continue;
    }
    if (inLayerTable && code === "0" && value === "ENDTAB") {
      save();
      inLayerTable = false;
      parsingLayer = false;
      continue;
    }
    if (!inLayerTable) continue;
    if (code === "0" && value === "LAYER") {
      save();
      parsingLayer = true;
      name = null;
      aci = null;
      trueColor = null;
      continue;
    }
    if (!parsingLayer) continue;
    if (code === "2") name = value;
    if (code === "62") aci = value;
    if (code === "420") trueColor = value;
  }
  return map;
}

/** ENTITIES section: handle (uppercase) → colour, true colour and layer of each entity. */
export function parseDxfEntityData(content: string): Record<string, EntityData> {
  const map: Record<string, EntityData> = Object.create(null);
  let inEntities = false;
  let inEntity = false;
  let handle: string | null = null;
  let color: string | null = null;
  let trueColor: string | null = null;
  let layer: string | null = null;

  const save = () => {
    if (inEntity && handle !== null) {
      map[handle.toUpperCase()] = {
        color: color !== null ? phpInt(color) : null,
        trueColor: trueColor !== null ? phpInt(trueColor) : null,
        layer,
      };
    }
  };
  const reset = () => {
    handle = null;
    color = null;
    trueColor = null;
    layer = null;
  };

  for (const [code, value] of groupPairs(content)) {
    if (code === "2" && value === "ENTITIES") {
      inEntities = true;
      continue;
    }
    if (!inEntities) continue;
    if (code === "0" && value === "ENDSEC") {
      save();
      break;
    }
    if (code === "0") {
      save();
      if (ENTITY_TYPES.has(value)) {
        inEntity = true;
        reset();
      } else if (value !== "VERTEX" && value !== "SEQEND") {
        // VERTEX / SEQEND belong to the preceding POLYLINE.
        inEntity = false;
        reset();
      }
      continue;
    }
    if (!inEntity) continue;
    if (code === "5" && handle === null) handle = value;
    if (code === "8" && layer === null) layer = value;
    if (code === "62" && color === null) color = value;
    if (code === "420" && trueColor === null) trueColor = value;
  }
  return map;
}

/** parse_dxf_colors.py (ezdxf): handle → hex colour, or {} when Python / ezdxf is unavailable. */
async function parseDxfEntityColorsWithPython(dxfPath: string): Promise<Record<string, string>> {
  let pythonPath = path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe");
  if (!existsSync(pythonPath)) {
    pythonPath = path.join(PROJECT_ROOT, ".venv", "bin", "python");
    if (!existsSync(pythonPath)) pythonPath = process.platform === "win32" ? "python" : "python3";
  }
  const scriptPath = path.join(PROJECT_ROOT, "src", "server", "services", "conversion", "parse_dxf_colors.py");
  logger.info(`DxfColorInjector executing Python script: ${pythonPath} ${scriptPath} ${dxfPath}`);

  let output = "";
  try {
    const result = await runProcess(pythonPath, [scriptPath, dxfPath], { timeoutMs: 120_000 });
    if (!result.successful) {
      logger.warning(
        `DxfColorInjector: Python script returned error code ${result.exitCode}. Please ensure Python 3 is installed and 'ezdxf' package is installed in your environment.`,
        { command: `${pythonPath} ${scriptPath} ${dxfPath}`, output: `${result.stdout}\n${result.stderr}` },
      );
      return {};
    }
    output = result.stdout;
  } catch (error) {
    logger.warning(`DxfColorInjector: Python script could not run: ${errorMessage(error)}`);
    return {};
  }

  try {
    const map: unknown = JSON.parse(output);
    if (map && typeof map === "object" && !Array.isArray(map) && Object.keys(map).length > 0) {
      return Object.fromEntries(Object.entries(map).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    }
  } catch {
    // Reported below.
  }
  logger.warning("DxfColorInjector: Failed to decode JSON from Python output", { output });
  return {};
}

type GeoJsonDocument = { features: Array<{ properties?: Record<string, unknown> | null; [key: string]: unknown }> };

/**
 * Injects colours from `dxfPath` into the GeoJSON at `geojsonPath` (rewritten in place).
 * Returns false when skipped. Optional enhancement: callers treat errors as non-critical.
 */
export async function injectDxfColors(dxfPath: string, geojsonPath: string): Promise<boolean> {
  if (!existsSync(dxfPath) || !existsSync(geojsonPath)) {
    logger.warning("DxfColorInjector: Input files not found.", { dxf: dxfPath, geojson: geojsonPath });
    return false;
  }

  // Bounded in-memory parser: large uploads still import their geometry, without colours.
  if ((await fs.stat(dxfPath)).size > MAX_DXF_BYTES || (await fs.stat(geojsonPath)).size > MAX_GEOJSON_BYTES) {
    logger.info("Skipping optional DXF color enhancement for a large dataset.");
    return false;
  }

  if (geodataConfig.enablePythonColorParser) {
    // The ezdxf parser runs on the host, not in the network-less converter container.
    logger.warning("GEODATA_ENABLE_PYTHON_COLOR_PARSER is on: parsing an uploaded DXF with ezdxf outside the converter sandbox.");
  }
  const handleColorMap = geodataConfig.enablePythonColorParser ? await parseDxfEntityColorsWithPython(dxfPath) : {};
  const usingFallback = Object.keys(handleColorMap).length === 0;
  let layerColorMap: Record<string, LayerColor> = {};
  let entityDataMap: Record<string, EntityData> = {};

  if (usingFallback) {
    logger.warning("DxfColorInjector: Python parsing failed or returned empty. Falling back to PHP parsing.");
    // latin1 keeps every byte; only ASCII group codes and hex handles are matched.
    const content = await fs.readFile(dxfPath, "latin1");
    layerColorMap = parseDxfLayerColors(content);
    logger.info(`DxfColorInjector: Parsed ${Object.keys(layerColorMap).length} layer color definitions (PHP fallback).`);
    entityDataMap = parseDxfEntityData(content);
    if (Object.keys(entityDataMap).length === 0) {
      logger.info("DxfColorInjector: No entities found in DXF via PHP fallback, skipping injection.");
      return false;
    }
    logger.info(`DxfColorInjector: Parsed ${Object.keys(entityDataMap).length} entity data mappings from DXF (PHP fallback).`);
  } else {
    logger.info(`DxfColorInjector: Parsed ${Object.keys(handleColorMap).length} entity color mappings from DXF using Python.`);
  }

  let data: GeoJsonDocument | null = null;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(geojsonPath, "utf8"));
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as GeoJsonDocument).features)) {
      data = parsed as GeoJsonDocument;
    }
  } catch {
    data = null;
  }
  if (!data) {
    logger.warning("DxfColorInjector: Invalid GeoJSON structure.");
    return false;
  }

  let injected = 0;
  for (const feature of data.features) {
    if (!feature || typeof feature !== "object") continue;
    const handle = feature.properties?.EntityHandle;
    if (handle === null || handle === undefined) continue;
    const key = String(handle).trim().toUpperCase();

    if (usingFallback) {
      const entity = entityDataMap[key];
      if (!entity) continue;
      feature.properties = {
        ...feature.properties,
        RawColor: resolveEntityColor(entity, layerColorMap),
        AciColor: resolveEntityAci(entity, layerColorMap),
      };
      injected++;
    } else if (handleColorMap[key] !== undefined) {
      // AciColor is superseded by RawColor when ezdxf resolved the colour.
      feature.properties = { ...feature.properties, RawColor: handleColorMap[key], AciColor: null };
      injected++;
    }
  }

  try {
    await fs.writeFile(geojsonPath, JSON.stringify(data));
  } catch {
    logger.error(`DxfColorInjector: Failed to write modified GeoJSON to ${geojsonPath}`);
    return false;
  }

  logger.info(`DxfColorInjector: Injected color for ${injected}/${data.features.length} features.`);
  return true;
}
