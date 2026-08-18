/**
 * UTM -> WGS84 lat/lon conversion (Snyder's standard inverse transverse Mercator formulas).
 * Accurate to well under a metre within a single UTM zone -- more than enough for matching a
 * drone photo's GPS EXIF coordinate to an individual panel a couple of metres wide.
 *
 * Edenvale's pica survey data (Datos_Backtracking_T1.xlsx) is in UTM Zone 56, Southern
 * Hemisphere (GDA MGA Zone 56) -- confirmed by cross-checking the farm's known public
 * location (~-26.93, 150.58) against the Excel's own easting/northing values (verified against
 * pyproj/EPSG:32756 to sub-millimetre agreement), since the source file doesn't state its zone
 * explicitly. If a future project's survey data uses a different zone, pass it explicitly --
 * don't assume 56S.
 */

const WGS84_A = 6378137.0; // semi-major axis, metres
const WGS84_F = 1 / 298.257223563; // flattening
const K0 = 0.9996; // UTM scale factor

export interface LatLon {
  lat: number;
  lon: number;
}

export function utmToLatLon(easting: number, northing: number, zone: number, southernHemisphere: boolean): LatLon {
  const a = WGS84_A;
  const f = WGS84_F;
  const e = Math.sqrt(f * (2 - f)); // first eccentricity
  const e1sq = (e * e) / (1 - e * e);

  const x = easting - 500000.0;
  const y = southernHemisphere ? northing - 10000000.0 : northing;

  const m = y / K0;
  const mu = m / (a * (1 - (e * e) / 4 - (3 * e ** 4) / 64 - (5 * e ** 6) / 256));

  const e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));

  const j1 = (3 * e1) / 2 - (27 * e1 ** 3) / 32;
  const j2 = (21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32;
  const j3 = (151 * e1 ** 3) / 96;
  const j4 = (1097 * e1 ** 4) / 512;

  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);

  const c1 = e1sq * Math.cos(fp) ** 2;
  const t1 = Math.tan(fp) ** 2;
  const r1 = (a * (1 - e * e)) / Math.pow(1 - e * e * Math.sin(fp) ** 2, 1.5);
  const n1 = a / Math.sqrt(1 - e * e * Math.sin(fp) ** 2);
  const d = x / (n1 * K0);

  const q1 = (n1 * Math.tan(fp)) / r1;
  const q2 = (d * d) / 2;
  const q3 = ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * e1sq) * d ** 4) / 24;
  const q4 = ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * e1sq - 3 * c1 * c1) * d ** 6) / 720;
  const lat = fp - q1 * (q2 - q3 + q4);

  const q5 = d;
  const q6 = ((1 + 2 * t1 + c1) * d ** 3) / 6;
  const q7 = ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * e1sq + 24 * t1 * t1) * d ** 5) / 120;
  const lonOriginRad = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const lon = lonOriginRad + (q5 - q6 + q7) / Math.cos(fp);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Great-circle-ish distance in metres between two lat/lon points (haversine) -- accurate
 * enough at this scale (tens/hundreds of metres across a solar farm). */
export function distanceMetres(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
