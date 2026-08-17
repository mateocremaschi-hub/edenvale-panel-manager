import * as XLSX from 'xlsx';
import { db } from './db';
import { newId } from './id';
import { nowIso } from './time';
import { getSupabase } from './supabase';
import type { ActivityEvent } from './types';

const HISTORICAL_MARKER = 'Historical import -- original technician not recorded';

export interface HistoricalCleanupResult {
  removedLocally: number;
  removedRemotely: number;
}

/**
 * Removes every Replacement (and its activity event) created by applyHistoricalReplacements,
 * identified by the fixed `replacedByName` marker -- WITHOUT touching the panel serial numbers
 * those runs already corrected. Use this if the historical import was run in "log as a visible
 * replacement" mode and the user decides afterwards they only wanted the silent data fix.
 */
export async function removeHistoricalReplacementRecords(onProgress?: (text: string) => void): Promise<HistoricalCleanupResult> {
  onProgress?.('Finding historical import records...');
  const toRemove = await db.replacements.filter((r) => r.replacedByName === HISTORICAL_MARKER).toArray();
  const ids = toRemove.map((r) => r.replacementId);

  if (ids.length > 0) {
    onProgress?.(`Removing ${ids.length} record(s) locally...`);
    await db.replacements.bulkDelete(ids);
    const events = await db.activityEvents.where('entityType').equals('replacement').and((e) => ids.includes(e.entityId)).toArray();
    await db.activityEvents.bulkDelete(events.map((e) => e.eventId));
  }

  let removedRemotely = 0;
  const supabase = getSupabase();
  if (supabase && ids.length > 0) {
    onProgress?.('Removing from the shared server...');
    const { error: e1, count } = await supabase
      .from('replacements')
      .delete({ count: 'exact' })
      .eq('replaced_by_name', HISTORICAL_MARKER);
    if (e1) throw new Error(`Removing from server failed: ${e1.message}`);
    removedRemotely = count ?? 0;
    const { error: e2 } = await supabase.from('activity_events').delete().eq('action', 'historical_replacement_imported');
    if (e2) throw new Error(`Removing activity history from server failed: ${e2.message}`);
  }

  return { removedLocally: ids.length, removedRemotely };
}

export interface HistoricalRow {
  before: string;
  after: string;
  moduleType?: string;
}

export interface HistoricalApplyResult {
  matched: number;
  vacated: number; // "after" wasn't a real serial -- destination marked vacant instead
  relocatedFrom: number; // "after" was found installed elsewhere -- that ORIGIN location marked vacant too
  notFound: string[]; // "before" serials that don't exist as a current panel
  alreadyCurrent: string[]; // "before" serial IS a panel, but its serial already equals "after" (re-run, no-op)
}

/** Real serials in this farm's data are long digit-only strings (e.g. "821051140249164146").
 * Anything else in the "after" column -- "To be installed", blank, "TBD", etc -- means the
 * panel was physically removed (e.g. relocated from a stopped tracker to a working one) and
 * nothing has been installed in its place yet, NOT a literal new serial number. Never write
 * that text into serialNumber: it isn't unique (many vacant slots could carry the exact same
 * placeholder text), which breaks the assumption that a serial identifies one panel and risks
 * false collisions in search/lookup. */
function looksLikeRealSerial(value: string): boolean {
  return /^\d{10,20}$/.test(value.trim());
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
 * For each row, looks up the "before" serial among CURRENT panels (the DESTINATION -- where a
 * panel is being installed/corrected) and logs a lightweight activity event for the audit
 * trail -- deliberately NOT a Replacement record, so this doesn't show up in the Replacements
 * list, the Corrective Report PDF, or the Dashboard's replacement counts. This is a silent data
 * correction (something that already happened in the field, not a new event happening today).
 *
 * IMPORTANT: if the "after" serial is a real one, this ALSO looks up where that panel is
 * CURRENTLY recorded -- if that's a different location, the panel was physically relocated
 * (e.g. moved from a stopped tracker to patch a working one), so its ORIGIN location is marked
 * vacant too. Without this, the origin slot would keep showing a serial number for a panel
 * that isn't physically there anymore. This origin check runs EVERY time, even when the
 * destination already matches "after" from an earlier run of this same file -- re-running
 * must still catch a relocation that hadn't been vacated yet, otherwise a file applied once
 * before this check existed would silently never trigger it.
 *
 * Rows whose "before" serial isn't found as a current panel are left alone and reported back --
 * that panel may already have been replaced again since, or the serial may not exist in this
 * farm's data at all; both are worth a human look, not a silent skip.
 */
export async function applyHistoricalReplacements(
  rows: HistoricalRow[],
  operatorId: string,
  onProgress?: (done: number, total: number) => void
): Promise<HistoricalApplyResult> {
  const result: HistoricalApplyResult = { matched: 0, vacated: 0, relocatedFrom: 0, notFound: [], alreadyCurrent: [] };

  for (let i = 0; i < rows.length; i++) {
    const { before, after, moduleType } = rows[i];
    onProgress?.(i + 1, rows.length);

    const destPanel = await db.panels.where('serialNumber').equals(before).first();
    if (!destPanel) {
      result.notFound.push(before);
      continue;
    }

    const isVacating = !looksLikeRealSerial(after);
    const destAlreadyMatches = destPanel.serialNumber === after;

    if (destAlreadyMatches) {
      result.alreadyCurrent.push(before);
    } else {
      const newSerial = isVacating ? `VACANT-${destPanel.locationId}` : after;
      const destEvent: ActivityEvent = {
        eventId: newId('evt'),
        entityType: 'panel',
        entityId: destPanel.panelId,
        action: isVacating ? 'historical_panel_vacated' : 'historical_serial_correction',
        previousValue: before,
        newValue: after,
        operator: operatorId,
        timestamp: nowIso(),
        syncStatus: 'pending',
        correctionReason: [moduleType ? `Module type: ${moduleType}` : null, isVacating ? `Spreadsheet said "${after}" -- treated as vacant, not a real serial.` : null]
          .filter(Boolean)
          .join(' '),
      };
      await db.transaction('rw', db.panels, db.activityEvents, async () => {
        await db.panels.update(destPanel.panelId, { serialNumber: newSerial, status: isVacating ? 'vacant' : 'normal' });
        await db.activityEvents.add(destEvent);
      });
      if (isVacating) result.vacated++;
      else result.matched++;
    }

    // Always check for a relocation, even when the destination already matched from an
    // earlier run -- re-running the same file must still catch an origin that hasn't been
    // vacated yet. Skipping this whenever destAlreadyMatches was a real bug: a file applied
    // once before this relocation check existed would silently never trigger it on re-run.
    if (!isVacating) {
      const originPanel = await db.panels.where('serialNumber').equals(after).first();
      if (originPanel && originPanel.locationId !== destPanel.locationId && !originPanel.serialNumber.startsWith('VACANT-')) {
        const originEvent: ActivityEvent = {
          eventId: newId('evt'),
          entityType: 'panel',
          entityId: originPanel.panelId,
          action: 'historical_panel_relocated',
          previousValue: after,
          newValue: `VACANT-${originPanel.locationId}`,
          operator: operatorId,
          timestamp: nowIso(),
          syncStatus: 'pending',
          correctionReason: `Panel ${after} was physically moved to ${destPanel.locationId} -- this, its original location, is now empty.`,
        };
        await db.transaction('rw', db.panels, db.activityEvents, async () => {
          await db.panels.update(originPanel.panelId, { serialNumber: `VACANT-${originPanel.locationId}`, status: 'vacant' });
          await db.activityEvents.add(originEvent);
        });
        result.relocatedFrom++;
      }
    }
  }

  return result;
}

export interface SuspectSerial {
  locationId: string;
  serialNumber: string;
}

/** Scans every panel for a serial that doesn't look like a real one (see looksLikeRealSerial)
 * and isn't already a properly-marked vacant slot ("VACANT-..."). Catches leftover bad values
 * from before this tool knew to handle non-serial "after" values specially -- e.g. a literal
 * "To be installed" written straight into serialNumber by an earlier run, or anything similar
 * already sitting in the original farm import. Doesn't fix anything, just reports so a human
 * can decide what each one should actually be. */
export async function findSuspectSerials(onProgress?: (scanned: number, total: number) => void): Promise<SuspectSerial[]> {
  const all = await db.panels.toArray();
  const suspects: SuspectSerial[] = [];
  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    if (i % 5000 === 0) onProgress?.(i, all.length);
    if (p.serialNumber.startsWith('VACANT-')) continue; // already properly marked, not a problem
    if (!looksLikeRealSerial(p.serialNumber)) suspects.push({ locationId: p.locationId, serialNumber: p.serialNumber });
  }
  onProgress?.(all.length, all.length);
  return suspects;
}
