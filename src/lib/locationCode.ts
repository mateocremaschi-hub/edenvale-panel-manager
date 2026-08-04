import type { LocationCodeParts } from './types';

// Matches "S-1.2.15.2.4.7" or "1.2.15.2.4.7" (the "S-" prefix used in the Excel's
// "BLOCK.INV.DCBOX.ARRAY.STRING.MODULE" column is optional here).
const CODE_RE = /^S?-?(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)$/i;

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
 * Placeholder North/South split from the module position alone (1 = North extreme,
 * 28 = South extreme, per spec). This is a simple midpoint heuristic for Etapa 0.
 * The authoritative split -- the Tracker Finder "biggest gap between wings" rule --
 * replaces this once that geometry is linked in Etapa 2.
 */
export function orientationFromModule(module: number): 'N' | 'S' | 'unknown' {
  if (module >= 1 && module <= 14) return 'N';
  if (module >= 15 && module <= 28) return 'S';
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
