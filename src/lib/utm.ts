export type UtmConfig = {
  zone: number;
  hemisphere: "N" | "S";
  epsg: string;
  label: string;
  def: string;
  prj: string;
};

/**
 * UTM zone settings used for coordinate display and as the default source CRS hint.
 * The server passes this to the browser as window.APP_GIS_CONFIG.
 */
export function buildUtmConfig(zoneInput: number, hemisphereInput: string): UtmConfig {
  const zone = Number.isInteger(zoneInput) && zoneInput >= 1 && zoneInput <= 60 ? zoneInput : 49;
  const hemisphere = hemisphereInput.toUpperCase() === "S" ? "S" : "N";
  const isSouth = hemisphere === "S";
  const centralMeridian = zone * 6 - 183;
  const falseNorthing = isSouth ? 10000000.0 : 0.0;

  return {
    zone,
    hemisphere,
    epsg: `EPSG:${(isSouth ? 32700 : 32600) + zone}`,
    label: `UTM Zone ${zone}${hemisphere}`,
    def: `+proj=utm +zone=${zone} ${isSouth ? "+south " : ""}+datum=WGS84 +units=m +no_defs +type=crs`,
    prj:
      `PROJCS["WGS_84_UTM_zone_${zone}${hemisphere}",` +
      'GEOGCS["GCS_WGS_1984",' +
      'DATUM["D_WGS_1984",' +
      'SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
      'PRIMEM["Greenwich",0.0],' +
      'UNIT["Degree",0.0174532925199433]],' +
      'PROJECTION["Transverse_Mercator"],' +
      'PARAMETER["False_Easting",500000.0],' +
      `PARAMETER["False_Northing",${falseNorthing.toFixed(1)}],` +
      `PARAMETER["Central_Meridian",${centralMeridian.toFixed(1)}],` +
      'PARAMETER["Scale_Factor",0.9996],' +
      'PARAMETER["Latitude_Of_Origin",0.0],' +
      'UNIT["Meter",1.0]]',
  };
}
