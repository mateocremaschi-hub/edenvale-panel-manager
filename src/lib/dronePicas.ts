import * as XLSX from 'xlsx';
import { db } from './db';
import type { TrackerPica } from './db';
import { utmToLatLon, distanceMetres, type LatLon } from './utm';
import { loadBlockGeometry } from './geometry';
import { parseStringCode } from './locationCode';

// Confirmed by cross-checking the survey file's own easting/northing against Edenvale's known
// public location (see utm.ts) -- change if a future project's survey uses a different zone.
const UTM_ZONE = 56;
const UTM_SOUTHERN = true;

const PANELS_PER_ROW = 28; // one string's worth -- matches every tracker row at Edenvale

export interface PicaImportRow {
  block: number;
  tracker: number;
  isMotorRow: boolean;
  north: LatLon;
  south: LatLon;
}

function col(header: string[], ...names: string[]): number {
  const lower = header.map((h) => h.toLowerCase().replace(/\s+/g, ''));
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase().replace(/\s+/g, ''));
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Parses the drone-survey pica Excel (any sheet -- tries each until one has the right
 * columns, so it doesn't matter if "DATA" isn't first). Converts UTM easting/northing straight
 * to lat/lon at parse time so nothing downstream needs to think about UTM again. */
export async function parsePicaExcelFile(file: File): Promise<PicaImportRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    if (rows.length < 2) continue;
    const header = rows[0].map((h) => String(h ?? ''));
    const cBlock = col(header, 'bloque', 'block');
    const cTracker = col(header, 'tracker');
    const cX1 = col(header, 'pica1x');
    const cY1 = col(header, 'pica1y');
    const cX2 = col(header, 'pica2x');
    const cY2 = col(header, 'pica2y');
    const cMotor = col(header, 'motorrow', 'motor');
    if ([cBlock, cTracker, cX1, cY1, cX2, cY2, cMotor].some((i) => i === -1)) continue;

    const out: PicaImportRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const block = Number(r[cBlock]);
      const tracker = Number(r[cTracker]);
      const x1 = Number(r[cX1]);
      const y1 = Number(r[cY1]);
      const x2 = Number(r[cX2]);
      const y2 = Number(r[cY2]);
      if (!block || !tracker || !Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
      const isMotorRow = String(r[cMotor] ?? '').trim().toUpperCase() === 'YES';
      out.push({
        block,
        tracker,
        isMotorRow,
        north: utmToLatLon(x1, y1, UTM_ZONE, UTM_SOUTHERN),
        south: utmToLatLon(x2, y2, UTM_ZONE, UTM_SOUTHERN),
      });
    }
    if (out.length > 0) return out;
  }
  throw new Error('Could not find columns matching bloque/tracker/pica1X/pica1Y/pica2X/pica2Y/MOTOR ROW in this file.');
}

export async function importTrackerPicas(rows: PicaImportRow[]): Promise<number> {
  const records: TrackerPica[] = rows.map((r) => ({
    id: `${r.block}-${r.tracker}-${r.isMotorRow ? 'motor' : 'slave'}`,
    block: r.block,
    tracker: r.tracker,
    isMotorRow: r.isMotorRow,
    northLat: r.north.lat,
    northLon: r.north.lon,
    southLat: r.south.lat,
    southLon: r.south.lon,
  }));
  await db.trackerPicas.bulkPut(records);
  return records.length;
}

/** Position 1..N linearly interpolated between a tracker row's north and south pica. Picas
 * sit just beside the first/last panel rather than exactly on them, so this is a close
 * approximation, not survey-exact -- fine for narrowing a drone photo down to one panel out
 * of 377,884, which is the point. */
function interpolate(pica: TrackerPica, position: number, total: number): LatLon {
  const t = total > 1 ? (position - 1) / (total - 1) : 0;
  return {
    lat: pica.northLat + (pica.southLat - pica.northLat) * t,
    lon: pica.northLon + (pica.southLon - pica.northLon) * t,
  };
}

/** Closest point on the north-south segment to a query point, in metres of perpendicular +
 * along-track distance combined -- simple equirectangular flattening (fine at farm scale, a
 * few km across at most) rather than full geodesic math, since we only need relative
 * distances to rank candidates, not absolute precision beyond a metre or so. */
function closestPointOnSegment(query: LatLon, pica: TrackerPica): { t: number; distanceM: number } {
  const refLat = (pica.northLat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(refLat);
  const toXY = (p: LatLon) => ({ x: p.lon * mPerDegLon, y: p.lat * mPerDegLat });
  const n = toXY({ lat: pica.northLat, lon: pica.northLon });
  const s = toXY({ lat: pica.southLat, lon: pica.southLon });
  const q = toXY(query);
  const dx = s.x - n.x;
  const dy = s.y - n.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((q.x - n.x) * dx + (q.y - n.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const closest = { x: n.x + dx * t, y: n.y + dy * t };
  const distanceM = Math.hypot(q.x - closest.x, q.y - closest.y);
  return { t, distanceM };
}

export interface PanelMatch {
  block: number;
  tracker: number;
  position: number;
  distanceM: number;
  locationId?: string; // resolved once the block's geometry + string mapping is loaded
  serialNumber?: string;
  row?: string; // e.g. "R4" -- which physical row this was, once resolved
  positionUnconfirmed?: boolean; // geometry unavailable -- couldn't apply the North/South flip
}

/**
 * Finds the tracker row whose north-south line the query point sits closest to, then the
 * nearest of its 28 interpolated panel positions along that line. Two-pass: the first pass
 * only touches trackerPicas (fast, no per-block geometry needed) to find the single best
 * (block, tracker, row) by raw distance; only THEN is that one block's geometry loaded to
 * resolve the exact location code, current panel, AND the true module-1 direction -- not
 * every candidate block, just the winner.
 */
export async function findNearestPanel(query: LatLon): Promise<PanelMatch | null> {
  const picas = await db.trackerPicas.toArray();
  if (picas.length === 0) return null;

  let best: { pica: TrackerPica; t: number; distanceM: number } | null = null;
  for (const pica of picas) {
    const { t, distanceM } = closestPointOnSegment(query, pica);
    if (!best || distanceM < best.distanceM) best = { pica, t, distanceM };
  }
  if (!best) return null;

  // Raw position treating the north pica as position 1 -- only actually correct for
  // South-side trackers (see the flip below).
  const rawPosition = Math.max(1, Math.min(PANELS_PER_ROW, Math.round(best.t * (PANELS_PER_ROW - 1)) + 1));
  let position = rawPosition;
  const match: PanelMatch = {
    block: best.pica.block,
    tracker: best.pica.tracker,
    position,
    distanceM: best.distanceM,
  };

  // Resolve the exact string/location code via that block's geometry, using two rules
  // confirmed by the user: (1) within a paired tracker, the MOTOR row is always the
  // numerically-lower row label (R2 motor pairs with R3 slave; R4 motor pairs with R5
  // slave) -- a single-row tracker (R1) has no pairing at all. (2) DC boxes sit in the
  // access road between the North and South sets of trackers, so module 1 (always nearest
  // THAT string's own DC box) is at the SOUTH end for North-side trackers, but at the NORTH
  // end for South-side trackers -- the two sets face the same middle road from opposite
  // sides. Concretely: the north pica sits near module 28 on a North-side tracker, but near
  // module 1 on a South-side tracker -- so North-side trackers need the raw (north-pica=1)
  // position flipped; South-side trackers use it as-is.
  try {
    const blockStr = String(best.pica.block).padStart(2, '0');
    const geometry = await loadBlockGeometry(best.pica.block);
    const trackerKey = `${blockStr}-${String(best.pica.tracker).padStart(3, '0')}`;
    const trackerGeo = geometry?.trackers[trackerKey];
    if (trackerGeo) {
      if (trackerGeo.side === 'North') position = PANELS_PER_ROW + 1 - rawPosition;
      match.position = position;

      const rows = [...trackerGeo.rows].sort();
      const row = rows.length === 1 ? rows[0] : best.pica.isMotorRow ? rows[0] : rows[1];
      match.row = row;
      const stringEntry = geometry.strings.find((s) => s.t === String(best!.pica.tracker).padStart(3, '0') && s.r === row);
      if (stringEntry) {
        const parts = parseStringCode(stringEntry.n);
        if (parts) {
          match.locationId = `${parts.block}.${parts.inverter}.${parts.dcBox}.${parts.arrayBus}.${parts.string}.${position}`;
          const panel = await db.panels.get(match.locationId);
          if (panel) match.serialNumber = panel.serialNumber;
        }
      }
    }
  } catch {
    // geometry not available for this block -- still return the block/tracker/position match,
    // just without the exact location code (and without the North/South flip, since that also
    // needs the geometry -- flag this rather than silently guess)
    match.positionUnconfirmed = true;
  }

  return match;
}
