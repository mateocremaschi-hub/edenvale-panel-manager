import type { Panel } from './types';

/** The nominal power classes installed on this farm, per the master Excel's "Pnom (W)" column
 * (values like "535W-L" / "540W-L" / "545W-L"). This is the panel datum the field team actually
 * cares about -- NOT the Vmp voltage, which the app used to surface everywhere and which the
 * user confirmed is irrelevant to day-to-day work. */
export const WATT_CLASSES = [535, 540, 545] as const;

/** Pulls the nominal watt class out of the master Excel's grade string ("535W-L" -> 535).
 * Accepts a bare number too. Returns undefined for anything unparseable. */
export function parseWattClass(grade: string | number | null | undefined): number | undefined {
  if (grade == null) return undefined;
  if (typeof grade === 'number') return Number.isFinite(grade) ? Math.round(grade) : undefined;
  const m = String(grade).match(/(\d{3})/);
  return m ? Number(m[1]) : undefined;
}

/** The watt class to show for a panel, preferring the explicit wattClass field, falling back
 * to parsing the raw grade string (older locally-imported records only have the grade). */
export function panelWatts(p: Pick<Panel, 'electrical'> | null | undefined): number | undefined {
  if (!p?.electrical) return undefined;
  return p.electrical.wattClass ?? parseWattClass(p.electrical.grade);
}

export function formatWatts(w: number | undefined): string {
  return w != null ? `${w}W` : '-';
}
