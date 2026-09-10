import { db } from './db';
import type { ImportRow } from './importTypes';
import type { Panel } from './types';
import { looksLikeRealSerial } from './panelDisplay';
import { parseWattClass } from './watts';
import { pushPanelsById } from './sync';

/**
 * "Load panel Watts from master Excel" -- a one-time enrichment that ONLY fills in each panel's
 * nominal watt class (535/540/545), matched by SERIAL NUMBER, never by location.
 *
 * Why not just re-run the normal import? Two reasons, both about the field corrections this
 * app has accumulated since the original import:
 *   - the normal import skips any location whose recorded serial differs from the Excel's
 *     (moved panels, corrected slots, vacant slots that the Excel still lists as filled) -- so
 *     exactly the panels that have been touched in the field would never get their watts;
 *   - commitBatch rebuilds the whole Panel object from the Excel row, so it would also overwrite
 *     install dates / master data from wherever the panel USED to be listed.
 * Matching by serial sidesteps all of that: a panel's watt class travels with the physical
 * panel, wherever it's been moved to. Vacant slots (VACANT-* serials) are left alone.
 *
 * Also the ONLY reliable way to get this datum onto every device: the original Excel import
 * stored the raw grade string locally, but Supabase never carried it, and every pull replaced
 * the whole panel record -- so devices that got their data from the server (i.e. all of them
 * except the one that ran the import) never had it at all.
 */
export interface WattsEnrichmentStats {
  excelSerialsWithWatts: number;
  panelsChecked: number;
  panelsUpdated: number;
  panelsUnchanged: number;
  panelsNotInExcel: number; // real serial in the app, but the Excel has no watts for it
  pushed: number;
  pushFailed: boolean;
}

export function collectWattsFromRows(rows: ImportRow[], into: Map<string, number>) {
  for (const row of rows) {
    if (!row.serialNumber || !looksLikeRealSerial(row.serialNumber)) continue;
    const w = parseWattClass(row.grade);
    if (w != null) into.set(row.serialNumber, w);
  }
}

export async function applyWattsEnrichment(
  wattsBySerial: Map<string, number>,
  onProgress?: (phase: string, done: number, total: number) => void
): Promise<WattsEnrichmentStats> {
  const stats: WattsEnrichmentStats = {
    excelSerialsWithWatts: wattsBySerial.size,
    panelsChecked: 0,
    panelsUpdated: 0,
    panelsUnchanged: 0,
    panelsNotInExcel: 0,
    pushed: 0,
    pushFailed: false,
  };

  const total = await db.panels.count();
  const changed: Panel[] = [];
  // Every panel that has a watt value in the Excel, changed locally or not. "Already correct on
  // THIS device" says nothing about the server -- the first real run of this tool found 377k
  // panels already carrying watts locally (a normal Import had stored them, and Import never
  // pushes), so pushing only the changed ones would have left the server -- and every other
  // device -- without watts entirely.
  const toPushIds: string[] = [];
  let scanned = 0;
  await db.panels.each((p) => {
    scanned++;
    if (scanned % 5000 === 0) onProgress?.('Matching panels to Excel', scanned, total);
    if (!looksLikeRealSerial(p.serialNumber)) return; // vacant slot -- nothing to enrich
    stats.panelsChecked++;
    const w = wattsBySerial.get(p.serialNumber);
    if (w == null) {
      stats.panelsNotInExcel++;
      return;
    }
    toPushIds.push(p.panelId);
    if (p.electrical?.wattClass === w) {
      stats.panelsUnchanged++;
      return;
    }
    // Merge -- keep whatever other electrical readings this record already carries.
    changed.push({ ...p, electrical: { ...(p.electrical ?? {}), wattClass: w } });
  });
  stats.panelsUpdated = changed.length;

  // Write locally in chunks so a single giant bulkPut doesn't stall the UI thread.
  const CHUNK = 5000;
  for (let i = 0; i < changed.length; i += CHUNK) {
    onProgress?.('Saving locally', i, changed.length);
    await db.panels.bulkPut(changed.slice(i, i + CHUNK));
  }

  // Push to the server so every other device gets it. pushPanelsById batches at 500 internally;
  // chunk the id list here too so progress stays visible on a ~378k-panel first run.
  const ids = toPushIds;
  try {
    for (let i = 0; i < ids.length; i += 2000) {
      onProgress?.('Sending to server', i, ids.length);
      await pushPanelsById(ids.slice(i, i + 2000));
      stats.pushed = Math.min(ids.length, i + 2000);
    }
  } catch (err) {
    console.error('Pushing enriched watts failed:', err);
    stats.pushFailed = true;
  }
  onProgress?.('Done', ids.length, ids.length);
  return stats;
}
