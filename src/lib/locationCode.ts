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
