import type { LocationCodeParts } from './types';

// Matches "S-1.2.15.2.4.7" or "1.2.15.2.4.7" (the "S-" prefix used in the Excel's
// "BLOCK.INV.DCBOX.ARRAY.STRING.MODULE" column is optional here).
const CODE_RE = /^S?-?(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)$/i;
// String-level code (5 fields, no module) as found in the block plan geometry (all_blocks.json).
const STRING_CODE_RE = /^S?-?(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)$/i;

export interface StringCodeParts {
  block: number;
  inverter: number;
  dcBox: number;
  arrayBus: number;
  string: number;
}

export function parseStringCode(raw: string): StringCodeParts | null {
  const m = STRING_CODE_RE.exec(raw.trim());
  if (!m) return null;
  return {
    block: Number(m[1]),
    inverter: Number(m[2]),
    dcBox: Number(m[3]),
    arrayBus: Number(m[4]),
    string: Number(m[5]),
  };
}

export function buildStringCodeFromParts(p: StringCodeParts): string {
  return `S-${p.block}.${p.inverter}.${p.dcBox}.${p.arrayBus}.${p.string}`;
}

export function parseLocationCode(raw: string): LocationCodeParts | null {
  const m = CODE_RE.exec(raw.trim());
  if (!m) return null;
  return {
    block: Number(m[1]),
    inverter: Number(m[2]),
    dcBox: Number(m[3]),
    arrayBus: Number(m[4]),
    string: Number(m[5]),
    module: Number(m[6]),
  };
}

export function buildLocationId(p: LocationCodeParts): string {
  return `${p.block}.${p.inverter}.${p.dcBox}.${p.arrayBus}.${p.string}.${p.module}`;
}

export function buildStringCode(p: LocationCodeParts): string {
  return `S-${p.block}.${p.inverter}.${p.dcBox}.${p.arrayBus}.${p.string}`;
}

export function buildArrayBusCode(p: LocationCodeParts): string {
  return `AR-${p.block}.${p.inverter}.${p.dcBox}.${p.arrayBus}`;
}

export function buildDcBoxCode(p: LocationCodeParts): string {
  return `DCB-${p.block}.${p.inverter}.${p.dcBox}`;
}

/**
 * North/South is NOT reliably derivable from the module number alone -- confirmed against
 * the real farm data that the module-1-is-North convention does not hold consistently
 * across every string (it varies). Rather than assert a compass direction we can't actually
 * know, this always returns 'unknown'. The module number itself (from the Excel) is still
 * the correct, authoritative position within the string -- only the N/S label was a guess.
 */
export function orientationFromModule(_module: number): 'N' | 'S' | 'unknown' {
  return 'unknown';
}

/**
 * Sort key for a location code that orders NUMERICALLY per field (block, inverter,
 * dcBox, arrayBus, string, module) instead of alphabetically. Plain string sort would
 * put "9.1.1.1.1.10" before "9.1.1.1.1.2" (comparing "1" < "2" character by character) --
 * zero-padding each field first avoids that. Falls back to the raw string for anything
 * that doesn't parse, so it still sorts (just not numerically) instead of crashing.
 */
export function locationSortKey(locationId: string): string {
  const p = parseLocationCode(locationId);
  if (!p) return locationId;
  const pad = (n: number) => String(n).padStart(4, '0');
  return [p.block, p.inverter, p.dcBox, p.arrayBus, p.string, p.module].map(pad).join('.');
}

export function compareLocationIds(a: string, b: string): number {
  return locationSortKey(a).localeCompare(locationSortKey(b));
}
