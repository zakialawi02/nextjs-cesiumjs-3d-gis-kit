export const WGS84_EPSG = "EPSG:4326";

/**
 * Resolves the centralized UTM configuration.
 * Prioritizes window.APP_GIS_CONFIG (geodataConfig.utm from src/config/geodata.ts, set by the root layout),
 * with fallback to UTM Zone 49N.
 *
 * @returns {object} { zone, hemisphere, epsg, def, label, prj }
 */
export function resolveUtmConfig() {
    const raw = typeof window !== "undefined" && window.APP_GIS_CONFIG ? window.APP_GIS_CONFIG : {};
    const zone = parseInt(raw.zone, 10) || 49;
    const hemisphere = (raw.hemisphere || "N").toUpperCase() === "S" ? "S" : "N";
    const isSouth = hemisphere === "S";

    const epsg = raw.epsg || `EPSG:${isSouth ? 32700 + zone : 32600 + zone}`;
    const def = raw.def || `+proj=utm +zone=${zone} ${isSouth ? "+south " : ""}+datum=WGS84 +units=m +no_defs +type=crs`;
    const label = raw.label || `UTM Zone ${zone}${hemisphere}`;

    const centralMeridian = (zone * 6) - 183;
    const falseNorthing = isSouth ? 10000000.0 : 0.0;

    const prj = raw.prj ||
        'PROJCS["WGS_84_UTM_zone_' + zone + hemisphere + '",' +
        'GEOGCS["GCS_WGS_1984",' +
        'DATUM["D_WGS_1984",' +
        'SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
        'PRIMEM["Greenwich",0.0],' +
        'UNIT["Degree",0.0174532925199433]],' +
        'PROJECTION["Transverse_Mercator"],' +
        'PARAMETER["False_Easting",500000.0],' +
        'PARAMETER["False_Northing",' + falseNorthing.toFixed(1) + '],' +
        'PARAMETER["Central_Meridian",' + centralMeridian.toFixed(1) + '],' +
        'PARAMETER["Scale_Factor",0.9996],' +
        'PARAMETER["Latitude_Of_Origin",0.0],' +
        'UNIT["Meter",1.0]]';

    return { zone, hemisphere, epsg, def, label, prj };
}

const currentConfig = resolveUtmConfig();

export const UTM_ZONE = currentConfig.zone;
export const UTM_HEMISPHERE = currentConfig.hemisphere;
export const UTM_EPSG = currentConfig.epsg;
export const UTM_DEF = currentConfig.def;
export const UTM_LABEL = currentConfig.label;
export const UTM_PRJ = currentConfig.prj;
