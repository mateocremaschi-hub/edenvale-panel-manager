import * as XLSX from 'xlsx';
import { db } from './db';
import type { TrackerPica } from './db';
import { getSupabase } from './supabase';
import { utmToLatLon, distanceMetres, type LatLon } from './utm';
import { loadBlockGeometry, type GeometryString } from './geometry';
import { parseStringCode, type StringCodeParts } from './locationCode';

// Confirmed by cross-checking the survey file's own easting/northing against Edenvale's known
// public location (see utm.ts) -- change if a future project's survey uses a different zone.
const UTM_ZONE = 56;
const UTM_SOUTHERN = true;

// A tracker ROW (e.g. "R2") spans 56 panels, not 28 -- confirmed both by the farm's own CONF
// sheet (n_modules_along_tracker: 56) and by the geometry data: every (tracker, row) pair has
// exactly 2 strings (e.g. R2 has strings ...7.1.1 and ...7.1.2), each 28 modules, not one
// string per row. A pica row's north-south line spans that full 56-panel width.
const PANELS_PER_ROW = 56;

// Real field measurements (user measured directly): panel width ~1.130m (matches the CONF
// sheet's module_width_m almost exactly), gap between panels ~0.020m, and -- importantly --
// the pica sits ~1.400m beyond the edge of the first/last panel, not right at it. Treating the
// whole pica-to-pica span as 56 EQUAL slices (the original approach) quietly assumed panel 1
// starts exactly at the pica, which overstates the true panel pitch and skews every position
// toward the middle. Using the real pitch (panel + gap) and subtracting the fixed offset before
// dividing gives a noticeably closer fit against real segment lengths (verified: a real 65.47m
// segment's position-56 center lands at 64.65m by this formula, leaving a sensible ~0.8m for
// the far end's own offset -- much tighter than assuming a uniform 56-way split).
const PANEL_PITCH_M = 1.13 + 0.02;
const PICA_OFFSET_M = 1.4;

function positionFromDistance(distanceM: number): number {
  const raw = Math.round((distanceM - PICA_OFFSET_M) / PANEL_PITCH_M) + 1;
  return Math.max(1, Math.min(PANELS_PER_ROW, raw));
}


// Which of a row's two strings sits nearest the DC box -- confirmed by 4 real field tests
// across 2 different trackers on BOTH sides of the road: the LOWER-numbered of the two always
// covers the DC-box-near half (combined positions 1-28), the higher-numbered one the far half
// (29-56) -- the same way on both North and South side trackers (this doesn't flip with side --
// only the module numbering direction does, via the North/South pica flip elsewhere in this
// file). IMPORTANT: the two string numbers for a given (tracker, row) are NOT always literally
// "1" and "2" -- they're whatever position that (tracker, row) happens to fall at within its
// arrayBus's own string count, e.g. block 7 tracker 028's R4 row uses strings 5 and 6
// (S-7.2.12.1.5 / .1.6), not 1/2. So this is relative (lower vs higher of whichever two numbers
// actually exist for this row), never a comparison against a literal constant.
function halfAndModule(position: number): { nearHalf: boolean; module: number } {
  const nearHalf = position <= 28;
  const module = nearHalf ? position : position - 28;
  return { nearHalf, module };
}


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
  // Push to the shared server right away, so every other device picks this up on its next
  // sync (every ~3 minutes while online, or right away if the person taps "Sync now") without
  // anyone else needing to import the same Excel themselves.
  try {
    await pushTrackerPicas(records);
  } catch (err) {
    console.error('Pushing tracker picas failed (will retry on next sync):', err);
  }
  return records.length;
}

/** Uploads tracker pica rows to the shared server. Called automatically right after a local
 * import, and safe to call again later (e.g. from the regular sync cycle) -- upserts by id. */
export async function pushTrackerPicas(records?: TrackerPica[]): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;
  const rows = records ?? (await db.trackerPicas.toArray());
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({
    id: r.id,
    block: r.block,
    tracker: r.tracker,
    is_motor_row: r.isMotorRow,
    north_lat: r.northLat,
    north_lon: r.northLon,
    south_lat: r.southLat,
    south_lon: r.southLon,
  }));
  // Supabase upsert has a practical row-count cap per request -- batch defensively even
  // though this table is small (at most ~36 blocks x ~190 rows).
  for (let i = 0; i < payload.length; i += 1000) {
    const { error } = await supabase.from('tracker_picas').upsert(payload.slice(i, i + 1000));
    if (error) throw new Error(`Uploading tracker picas failed: ${error.message}`);
  }
  return rows.length;
}

/** Downloads every tracker pica row from the shared server -- small table (a few thousand
 * rows even with all 36 blocks), so a full pull each time is simple and cheap enough, same
 * pattern as issues/replacements. Called automatically by the regular sync cycle so a
 * technician who never ran the Excel import still sees GPS lookup work. */
export async function pullTrackerPicas(): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  // Supabase caps an unpaginated select('*') at 1000 rows by default -- with all 36 blocks
  // this table can hold several thousand, so a single unpaginated call silently truncated to
  // whichever 1000 rows happened to come back first, missing entire blocks. Page through in
  // batches of 1000 (same pattern as pullLocationsAndPanels) until a batch comes back short.
  const BATCH = 1000;
  let from = 0;
  const allRows: Record<string, unknown>[] = [];
  for (;;) {
    const { data, error } = await supabase.from('tracker_picas').select('*').range(from, from + BATCH - 1);
    if (error) throw new Error(`Downloading tracker picas failed: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  if (allRows.length === 0) return 0;

  const records: TrackerPica[] = allRows.map((r) => ({
    id: r.id as string,
    block: r.block as number,
    tracker: r.tracker as number,
    isMotorRow: r.is_motor_row as boolean,
    northLat: r.north_lat as number,
    northLon: r.north_lon as number,
    southLat: r.south_lat as number,
    southLon: r.south_lon as number,
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
function closestPointOnSegment(query: LatLon, pica: TrackerPica): { t: number; distanceM: number; segmentLengthM: number } {
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
  return { t, distanceM, segmentLengthM: Math.hypot(dx, dy) };
}

export interface PanelMatch {
  block: number;
  tracker: number;
  position: number; // module 1-28 within its string, once resolved (else the raw 1-56 row position)
  distanceM: number;
  locationId?: string; // resolved once the block's geometry + string mapping is loaded
  serialNumber?: string;
  row?: string; // e.g. "R4" -- which physical row this was, once resolved
  positionUnconfirmed?: boolean; // geometry unavailable -- couldn't apply the North/South flip or string split
  nearbyCandidates?: { locationId: string; serialNumber?: string; offset: number }[]; // offset: -2..+2 panels from the main match, for visual cross-checking against GPS uncertainty
  debug: {
    isMotorRow: boolean;
    t: number; // 0 = north pica, 1 = south pica, along the matched row's line
    rawPosition: number; // 1-56, north-pica=1 assumption, before any side flip
    combinedPosition: number; // 1-56, after the North/South flip
    side?: 'North' | 'South';
    segmentLengthM: number;
  };
}

/**
 * Finds the tracker row whose north-south line the query point sits closest to, then the
 * nearest of its 56 interpolated panel positions along that row (a row like "R2" has TWO
 * strings of 28 modules each, not one -- see PANELS_PER_ROW). Two-pass: the first pass only
 * touches trackerPicas (fast, no per-block geometry needed) to find the single best (block,
 * tracker, row) by raw distance; only THEN is that one block's geometry loaded to resolve the
 * exact string, module, location code, current panel, and the true module-1 direction -- not
 * every candidate block, just the winner.
 */
export interface NoNearbyMatch {
  noNearbyData: true;
  closestDistanceM: number;
  closestBlock: number;
  closestTracker: number;
}

export async function findNearestPanel(query: LatLon): Promise<PanelMatch | NoNearbyMatch | null> {
  const picas = await db.trackerPicas.toArray();
  if (picas.length === 0) return null;

  let best: { pica: TrackerPica; t: number; distanceM: number; segmentLengthM: number } | null = null;
  for (const pica of picas) {
    const { t, distanceM, segmentLengthM } = closestPointOnSegment(query, pica);
    if (!best || distanceM < best.distanceM) best = { pica, t, distanceM, segmentLengthM };
  }
  if (!best) return null;

  // A real match should be within a few metres of some tracker's line -- GPS/pica survey
  // error doesn't explain being hundreds of metres off. If the CLOSEST available line is still
  // this far away, the real block/tracker simply isn't in the loaded pica data (a gap in
  // coverage, not a plausible match) -- say so plainly instead of confidently naming the
  // nearest-available block as if it were correct.
  const MAX_PLAUSIBLE_DISTANCE_M = 30;
  if (best.distanceM > MAX_PLAUSIBLE_DISTANCE_M) {
    return { noNearbyData: true, closestDistanceM: best.distanceM, closestBlock: best.pica.block, closestTracker: best.pica.tracker };
  }

  // Distance from the north pica along the row, in metres -- position comes from the real
  // panel pitch and pica offset (positionFromDistance), not from treating the whole pica-to-
  // pica span as 56 equal slices. This raw value still treats the north pica as position 1 --
  // only actually correct for South-side trackers (see the flip below).
  const distanceFromNorthPicaM = best.t * best.segmentLengthM;
  const rawPosition = positionFromDistance(distanceFromNorthPicaM);
  let combinedPosition = rawPosition;
  const match: PanelMatch = {
    block: best.pica.block,
    tracker: best.pica.tracker,
    position: combinedPosition,
    distanceM: best.distanceM,
    debug: {
      isMotorRow: best.pica.isMotorRow,
      t: best.t,
      rawPosition,
      combinedPosition,
      segmentLengthM: best.segmentLengthM,
    },
  };

  // Resolve the exact string/location code via that block's geometry, using rules confirmed
  // by the user: (1) within a paired tracker, the MOTOR row is always the numerically-lower
  // row label (R2 motor pairs with R3 slave; R4 motor pairs with R5 slave) -- a single-row
  // tracker (R1) has no pairing at all. (2) DC boxes sit in the access road between the North
  // and South sets of trackers, so module 1 (always nearest THAT string's own DC box) is at
  // the SOUTH end for North-side trackers, but at the NORTH end for South-side trackers --
  // the two sets face the same middle road from opposite sides. Concretely: the north pica
  // sits near combined-position 56 on a North-side tracker, but near combined-position 1 on
  // a South-side tracker -- so North-side trackers need the raw (north-pica=1) position
  // flipped; South-side trackers use it as-is. (3) of the row's two strings, whichever is
  // closer to the DC box covers combined positions 1-28 (see NEAR_DC_BOX_STRING_INDEX).
  try {
    const blockStr = String(best.pica.block).padStart(2, '0');
    const geometry = await loadBlockGeometry(best.pica.block);
    const trackerKey = `${blockStr}-${String(best.pica.tracker).padStart(3, '0')}`;
    const trackerGeo = geometry?.trackers[trackerKey];
    if (trackerGeo) {
      if (trackerGeo.side === 'North') combinedPosition = PANELS_PER_ROW + 1 - rawPosition;
      match.debug.combinedPosition = combinedPosition;
      match.debug.side = trackerGeo.side;

      const rows = [...trackerGeo.rows].sort();
      const row = rows.length === 1 ? rows[0] : best.pica.isMotorRow ? rows[0] : rows[1];
      match.row = row;

      // Find BOTH of this row's strings and sort by their actual string number -- never
      // assume it's literally "1" and "2" (see halfAndModule's note: block 7 tracker 028's R4
      // uses 5 and 6). Lower number = nearer the DC box, confirmed by 4 real field tests.
      const trackerNumStr = String(best.pica.tracker).padStart(3, '0');
      const rowStrings: { raw: GeometryString; parts: StringCodeParts }[] = [];
      for (const s of geometry.strings) {
        if (s.t !== trackerNumStr || s.r !== row) continue;
        const parts = parseStringCode(s.n);
        if (parts) rowStrings.push({ raw: s, parts });
      }
      rowStrings.sort((a, b) => a.parts.string - b.parts.string);

      function resolvePanel(position: number): { locationId: string; serialNumber?: string } | null {
        const { nearHalf, module } = halfAndModule(position);
        const entry = nearHalf ? rowStrings[0] : rowStrings[1];
        if (!entry) return null;
        const p = entry.parts;
        return { locationId: `${p.block}.${p.inverter}.${p.dcBox}.${p.arrayBus}.${p.string}.${module}`, serialNumber: undefined };
      }

      const main = resolvePanel(combinedPosition);
      if (main) {
        match.position = halfAndModule(combinedPosition).module;
        match.locationId = main.locationId;
        const panel = await db.panels.get(main.locationId);
        if (panel) match.serialNumber = panel.serialNumber;
      }

      // A drone photo's GPS is rarely survey-grade (a few metres of error is typical without
      // RTK correction) -- on a ~65m/56-panel row that alone can span 2-3 panels either way.
      // Rather than present one guess as certain, also resolve the +/-2 neighbours so the
      // technician can visually cross-check against the thermal photo instead of trusting a
      // single point estimate blindly.
      const candidates: { locationId: string; serialNumber?: string; offset: number }[] = [];
      for (let offset = -2; offset <= 2; offset++) {
        if (offset === 0) continue;
        const neighborCombined = combinedPosition + offset;
        if (neighborCombined < 1 || neighborCombined > PANELS_PER_ROW) continue;
        const n = resolvePanel(neighborCombined);
        if (!n) continue;
        const nPanel = await db.panels.get(n.locationId);
        candidates.push({ locationId: n.locationId, serialNumber: nPanel?.serialNumber, offset });
      }
      match.nearbyCandidates = candidates.sort((a, b) => a.offset - b.offset);
    }
  } catch {
    // geometry not available for this block -- still return the block/tracker/position match,
    // just without the exact location code (and without the North/South flip, since that also
    // needs the geometry -- flag this rather than silently guess)
    match.positionUnconfirmed = true;
  }

  return match;
}
