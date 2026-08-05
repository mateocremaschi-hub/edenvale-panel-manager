import { db } from './db';
import type { ImportRow } from './importTypes';
import type { PhysicalLocation, Panel, PanelStatus } from './types';
import { newId } from './id';
import { nowIso } from './time';
import { orientationFromModule } from './locationCode';

export interface ExistingPanelInfo {
  serialNumber: string;
  status: PanelStatus;
}

export interface CommitStats {
  created: number;
  updatedMasterData: number;
  unchanged: number;
  serialMismatch: number; // Excel serial differs from what's recorded -- flagged, NOT auto-applied
  skipped: number; // rows with status 'error'
  mismatches: { locationId: string; recordedSerial: string; excelSerial: string }[];
}

export function newCommitStats(): CommitStats {
  return { created: 0, updatedMasterData: 0, unchanged: 0, serialMismatch: 0, skipped: 0, mismatches: [] };
}

/**
 * Upserts one batch of parsed rows. Master/reference data (voltage, electrical readings,
 * install date) is safe to overwrite from the Excel since it's fixed at commissioning time.
 * `status` is always preserved for existing panels (a re-import must never silently reset
 * an in-progress issue/replacement back to "normal"). If the Excel's serial number differs
 * from what's already recorded at that location, the row is flagged as a mismatch and left
 * untouched -- changing a serial goes through the Replacements flow so it keeps a proper
 * audit trail, never through a bulk import.
 */
export async function commitBatch(
  batch: ImportRow[],
  existingPanels: Map<string, ExistingPanelInfo>,
  stats: CommitStats
) {
  const locations: PhysicalLocation[] = [];
  const panels: Panel[] = [];

  for (const row of batch) {
    if (row.status === 'error' || !row.locationId || !row.serialNumber || row.block === null) {
      stats.skipped++;
      continue;
    }

    const existing = existingPanels.get(row.locationId);
    if (existing && existing.serialNumber !== row.serialNumber) {
      stats.serialMismatch++;
      stats.mismatches.push({
        locationId: row.locationId,
        recordedSerial: existing.serialNumber,
        excelSerial: row.serialNumber,
      });
      continue; // do not touch this panel's data
    }

    locations.push({
      locationId: row.locationId,
      block: row.block,
      dcBox: row.dcBox ?? '',
      arrayBus: row.arrayBus ?? '',
      stringCode: row.stringCode ?? '',
      positionInString: row.positionInString ?? 0,
      orientation: orientationFromModule(row.positionInString ?? 0),
    });
    panels.push({
      panelId: row.locationId,
      serialNumber: row.serialNumber,
      serialNumberShort: row.serialNumberShort ?? undefined,
      voltage: row.voltage ?? undefined,
      locationId: row.locationId,
      status: existing?.status ?? 'normal', // preserve in-progress status; new panels start 'normal'
      installDate: row.installDate ?? undefined,
      electrical: {
        pmpW: row.pmpW ?? undefined,
        iscA: row.iscA ?? undefined,
        vocV: row.vocV ?? undefined,
        impA: row.impA ?? undefined,
        grade: row.grade ?? undefined,
        qcFlag: row.qcFlag ?? undefined,
      },
      sunManagerId: row.sunManagerId ?? undefined,
    });

    if (existing) stats.updatedMasterData++;
    else stats.created++;
  }

  if (locations.length === 0) return;

  await db.transaction('rw', db.locations, db.panels, async () => {
    await db.locations.bulkPut(locations);
    await db.panels.bulkPut(panels);
  });
}

/** Preloads {locationId -> current serial/status} once before an import run starts. */
export async function loadExistingPanelIndex(): Promise<Map<string, ExistingPanelInfo>> {
  const map = new Map<string, ExistingPanelInfo>();
  await db.panels.each((p) => {
    map.set(p.locationId, { serialNumber: p.serialNumber, status: p.status });
  });
  return map;
}

/** One summary audit event for the whole import run (not one per row -- see README). */
export async function logImportEvent(operatorId: string, summaryText: string) {
  await db.activityEvents.add({
    eventId: newId('evt'),
    entityType: 'panel',
    entityId: 'bulk-import',
    action: 'excel_import',
    newValue: summaryText,
    operator: operatorId,
    timestamp: nowIso(),
    syncStatus: 'pending',
  });
}
