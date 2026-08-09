import * as XLSX from 'xlsx';
import { db } from './db';
import { newId } from './id';
import { nowIso } from './time';
import type { Replacement, ActivityEvent } from './types';

export interface HistoricalRow {
  before: string;
  after: string;
  moduleType?: string;
}

export interface HistoricalApplyResult {
  matched: number;
  notFound: string[]; // "before" serials that don't exist as a current panel
  alreadyCurrent: string[]; // "before" serial IS a panel, but its serial already equals "after" (re-run, no-op)
}

/** Reads the "Serial Number (Before)" / "Serial Number (After)" / "Type of module" columns from
 * an uploaded xlsx (any sheet, matched by header name so column order doesn't matter). Rows
 * missing either serial are skipped. */
export async function parseHistoricalReplacementsFile(file: File): Promise<HistoricalRow[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    if (rows.length < 2) continue;

    const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
    const beforeIdx = header.findIndex((h) => h.includes('before'));
    const afterIdx = header.findIndex((h) => h.includes('after'));
    if (beforeIdx === -1 || afterIdx === -1) continue; // not the right sheet, try the next one
    const typeIdx = header.findIndex((h) => h.includes('type') || h.includes('module'));

    const out: HistoricalRow[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const before = row[beforeIdx] != null ? String(row[beforeIdx]).trim() : '';
      const after = row[afterIdx] != null ? String(row[afterIdx]).trim() : '';
      if (!before || !after) continue;
      out.push({
        before,
        after,
        moduleType: typeIdx !== -1 && row[typeIdx] != null ? String(row[typeIdx]).trim() : undefined,
      });
    }
    if (out.length > 0) return out;
  }

  throw new Error('Could not find columns matching "Serial Number (Before)" / "(After)" in this file.');
}

/**
 * For each row, looks up the "before" serial among CURRENT panels. If found, records a proper
 * Replacement (so it shows up in reports/history like any other, honestly flagged as a
 * historical import since the real date/technician aren't known) and updates that panel's
 * serial to "after". Rows whose "before" serial isn't found as a current panel are left alone
 * and reported back -- that panel may already have been replaced again since, or the serial may
 * not exist in this farm's data at all; both are worth a human look, not a silent skip.
 */
export async function applyHistoricalReplacements(
  rows: HistoricalRow[],
  operatorId: string,
  onProgress?: (done: number, total: number) => void
): Promise<HistoricalApplyResult> {
  const result: HistoricalApplyResult = { matched: 0, notFound: [], alreadyCurrent: [] };
  const importNote = `Historical replacement imported from Excel on ${nowIso().slice(0, 10)} -- original replacement date and technician were not recorded.`;

  for (let i = 0; i < rows.length; i++) {
    const { before, after, moduleType } = rows[i];
    onProgress?.(i + 1, rows.length);

    const panel = await db.panels.where('serialNumber').equals(before).first();
    if (!panel) {
      result.notFound.push(before);
      continue;
    }
    if (panel.serialNumber === after) {
      result.alreadyCurrent.push(before);
      continue;
    }

    const replacementId = newId('repl');
    const rec: Replacement = {
      replacementId,
      locationId: panel.locationId,
      removedPanelId: panel.panelId,
      removedSerial: before,
      installedPanelId: panel.panelId,
      installedSerial: after,
      oldVoltage: panel.voltage,
      replacementDate: nowIso(),
      replacedBy: operatorId,
      replacedByName: 'Historical import -- original technician not recorded',
      reason: 'Panel found already replaced in the field; not previously logged.',
      photoIds: [],
      notes: [importNote, moduleType ? `Module type: ${moduleType}` : null].filter(Boolean).join(' '),
      syncStatus: 'pending',
    };

    const event: ActivityEvent = {
      eventId: newId('evt'),
      entityType: 'replacement',
      entityId: replacementId,
      action: 'historical_replacement_imported',
      operator: operatorId,
      timestamp: nowIso(),
      syncStatus: 'pending',
    };

    await db.transaction('rw', db.replacements, db.panels, db.activityEvents, async () => {
      await db.replacements.add(rec);
      await db.panels.update(panel.panelId, { serialNumber: after, status: 'replaced' });
      await db.activityEvents.add(event);
    });
    result.matched++;
  }

  return result;
}
