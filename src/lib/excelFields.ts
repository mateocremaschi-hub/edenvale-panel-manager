import type { ColumnMapping, ImportField } from './importTypes';

// Alias lists, most-specific first. Matching is case-insensitive "contains". The real
// headers confirmed in EDE-GRS-CM-RPT-3190-C1 (sheet INFORME, row 13) are listed first;
// generic fallbacks follow so re-exports with slightly different wording still map.
const ALIASES: Record<ImportField, string[]> = {
  locationCode: ['block.inv.dcbox.array.string.module', 'location code', 'location', 'array.string'],
  serialNumber: ['serial number', 'serial no', 'serialnumber'],
  serialNumberShort: ['s/n (14', 's/n short', 'short serial'],
  voltage: ['vmp (v)', 'vmp', 'voltage'],
  pmpW: ['pmp (w)', 'pmp'],
  iscA: ['isc (a)', 'isc'],
  vocV: ['voc (v)', 'voc'],
  impA: ['imp (a)', 'imp'],
  grade: ['pnom (w)', 'pnom', 'grade'],
  qcFlag: ['pmp>pnom', 'qc', 'quality'],
  sunManagerId: ['sunmanager', 'sun manager', 'wo sm', 'work order'],
  installDate: ['install date', 'installation date', 'production date'],
};

/** Best-effort column mapping guess from header names; the user can always override it. */
export function autoDetectMapping(headers: (string | number | null)[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<ImportField>();

  headers.forEach((raw) => {
    const header = String(raw ?? '').trim();
    if (!header) return;
    const lower = header.toLowerCase();
    for (const field of Object.keys(ALIASES) as ImportField[]) {
      if (used.has(field)) continue;
      if (ALIASES[field].some((alias) => lower.includes(alias))) {
        mapping[header] = field;
        used.add(field);
        return;
      }
    }
    mapping[header] = null;
  });

  return mapping;
}
