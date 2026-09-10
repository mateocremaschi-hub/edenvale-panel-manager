import { ExcelImportSession } from './importRunner';
import { autoDetectMapping } from './excelFields';
import type { ColumnMapping, ImportRow } from './importTypes';
import { applyWattsEnrichment, collectWattsFromRows, type WattsEnrichmentStats } from './wattsEnrichment';

/**
 * One-step "Load panel Watts from master Excel": pick the file, done. No sheet / header /
 * column questions -- the user wanted exactly one thing (watts from column K = "Pnom (W)")
 * and the full import wizard's steps (and its "clear all data?" gate) only got in the way.
 *
 * Finds the sheet+row whose headers contain a serial column and a Pnom/watt column (INFORME is
 * tried first), maps just those (plus the location code when present, harmless), streams the
 * rows through the existing background worker, then runs the serial-matched enrichment.
 * Falls back to column K (index 10) for the watt column if no header name matches, since
 * that's where it lives in every export of this report so far.
 */
export async function loadWattsFromMasterExcel(
  file: File,
  onProgress: (phase: string, done: number, total: number) => void
): Promise<WattsEnrichmentStats> {
  const session = new ExcelImportSession();
  try {
    onProgress('Opening file', 0, 0);
    const sheets = await session.listSheets(file);
    const ordered = [...sheets.filter((s) => /informe/i.test(s)), ...sheets.filter((s) => !/informe/i.test(s))];

    let chosen: { headerRowIndex: number; mapping: ColumnMapping; totalRows: number } | null = null;
    for (const sheet of ordered) {
      onProgress(`Checking sheet ${sheet}`, 0, 0);
      const { totalRows, previewRows } = await session.parseSheet(sheet);
      for (let i = 0; i < Math.min(previewRows.length, 40); i++) {
        const cells = (previewRows[i] ?? []).map((c) => String(c ?? '').trim());
        const hasSerial = cells.some((c) => /serial/i.test(c));
        if (!hasSerial) continue;
        const mapping = autoDetectMapping(cells);
        const mapped = Object.values(mapping);
        if (!mapped.includes('serialNumber')) continue;
        if (!mapped.includes('grade')) {
          // Column K fallback -- only if K isn't already claimed by another field.
          if (cells.length > 10 && !mapping['10']) mapping['10'] = 'grade';
          else continue;
        }
        chosen = { headerRowIndex: i, mapping, totalRows };
        break;
      }
      if (chosen) break;
    }
    if (!chosen) {
      throw new Error(
        'Could not find a sheet with a "SERIAL NUMBER" column and a "Pnom (W)" (watts) column. Is this the master panels Excel?'
      );
    }

    const wattsBySerial = new Map<string, number>();
    await session.runImport(
      chosen.headerRowIndex,
      chosen.mapping,
      (batch: ImportRow[]) => collectWattsFromRows(batch, wattsBySerial),
      (processed, total) => onProgress('Reading Excel', processed, total)
    );
    if (wattsBySerial.size === 0) {
      throw new Error('The file was read but no watt values were found (expected values like "535W-L" in the Pnom column).');
    }
    return await applyWattsEnrichment(wattsBySerial, onProgress);
  } finally {
    session.terminate();
  }
}
