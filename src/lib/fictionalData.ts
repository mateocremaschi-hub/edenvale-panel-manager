import { db, setDataSource } from './db';
import { buildLocationId, buildStringCode, buildArrayBusCode, buildDcBoxCode, orientationFromModule } from './locationCode';
import type { PhysicalLocation, Panel, Operator, Issue, Replacement, ActivityEvent } from './types';
import { newId } from './id';
import { nowIso } from './time';

// Small, fast dataset for local dev/testing -- NOT the real farm. Shape mirrors the real
// Excel exactly (block.inverter.dcBox.arrayBus.string.module, 28 modules/string, module 1 =
// North .. 28 = South) so the importer built in Etapa 1 can target the same types untouched.
const FICTIONAL_BLOCKS = 2;
const STRINGS_PER_BLOCK = 6;
const MODULES_PER_STRING = 28;

function randomShortSerial(): string {
  return String(29_800_000_000_000 + Math.floor(Math.random() * 900_000_000_000)).slice(0, 14);
}

export async function seedFictionalDataIfEmpty() {
  const existing = await db.panels.count();
  if (existing > 0) return;

  const operators: Operator[] = [
    { operatorId: newId('op'), name: 'Test Operator One', active: true, role: 'Tracker Technician' },
    { operatorId: newId('op'), name: 'Test Operator Two', active: true, role: 'Tracker Technician' },
  ];

  const locations: PhysicalLocation[] = [];
  const panels: Panel[] = [];

  for (let block = 1; block <= FICTIONAL_BLOCKS; block++) {
    for (let s = 1; s <= STRINGS_PER_BLOCK; s++) {
      const baseParts = { block, inverter: 1, dcBox: Math.ceil(s / 2), arrayBus: s, string: s };
      for (let module = 1; module <= MODULES_PER_STRING; module++) {
        const parts = { ...baseParts, module };
        const locationId = buildLocationId(parts);
        locations.push({
          locationId,
          block,
          dcBox: buildDcBoxCode(parts),
          arrayBus: buildArrayBusCode(parts),
          stringCode: buildStringCode(parts),
          positionInString: module,
          orientation: orientationFromModule(module),
        });

        const shortSerial = randomShortSerial();
        const wattClass = [535, 540, 545][Math.floor(Math.random() * 3)];
        panels.push({
          panelId: locationId,
          serialNumber: `821${shortSerial}`,
          serialNumberShort: shortSerial,
          voltage: 40 + Math.random() * 3,
          locationId,
          status: 'normal',
          installDate: '2022-06-01',
          electrical: {
            pmpW: wattClass + Math.random() * 3,
            iscA: 13.6 + Math.random() * 0.2,
            vocV: 49.4 + Math.random() * 0.6,
            impA: 13.0 + Math.random() * 0.2,
            vmpV: 41 + Math.random() * 0.6,
            wattClass,
            grade: `${wattClass}W-L`,
            qcFlag: 'OK',
          },
        });
      }
    }
  }

  // A handful of issues / replacements so the Dashboard and other pages have something
  // real to show on first run.
  const issues: Issue[] = [];
  const replacements: Replacement[] = [];
  const events: ActivityEvent[] = [];

  panels.slice(0, 3).forEach((panel, i) => {
    panel.status = i === 2 ? 'monitoring' : 'issue_reported';
    const issueId = newId('iss');
    issues.push({
      issueId,
      locationId: panel.locationId,
      panelIdAtReport: panel.panelId,
      type: i === 0 ? 'bypass_diode_activated' : i === 1 ? 'broken_glass' : 'hotspot',
      severity: 'medium',
      description: 'Fictional test issue seeded for local development.',
      status: 'open',
      reportedBy: operators[0].operatorId,
      reportedDate: nowIso(),
      requiresReplacement: i !== 2,
      monitorOnly: i === 2,
      immediateSafetyConcern: false,
      photoIds: [],
      syncStatus: 'local',
    });
    events.push({
      eventId: newId('evt'),
      entityType: 'issue',
      entityId: issueId,
      action: 'issue_created',
      operator: operators[0].operatorId,
      timestamp: nowIso(),
      syncStatus: 'local',
    });
  });

  const removed = panels[10];
  if (removed) {
    const replacementId = newId('rep');
    const newSerial = `821${randomShortSerial()}`;
    replacements.push({
      replacementId,
      locationId: removed.locationId,
      removedPanelId: removed.panelId,
      removedSerial: removed.serialNumber,
      installedPanelId: removed.panelId,
      installedSerial: newSerial,
      oldVoltage: removed.voltage,
      newVoltage: 41.2,
      replacementDate: nowIso(),
      replacedBy: operators[1].operatorId,
      reason: 'Broken by wind (fictional test record)',
      photoIds: [],
      syncStatus: 'local',
    });
    removed.serialNumber = newSerial;
    removed.status = 'replaced';
    events.push({
      eventId: newId('evt'),
      entityType: 'replacement',
      entityId: replacementId,
      action: 'replacement_confirmed',
      operator: operators[1].operatorId,
      timestamp: nowIso(),
      syncStatus: 'local',
    });
  }

  await db.transaction(
    'rw',
    db.operators,
    db.locations,
    db.panels,
    db.issues,
    db.replacements,
    db.activityEvents,
    async () => {
      await db.operators.bulkAdd(operators);
      await db.locations.bulkAdd(locations);
      await db.panels.bulkAdd(panels);
      await db.issues.bulkAdd(issues);
      await db.replacements.bulkAdd(replacements);
      await db.activityEvents.bulkAdd(events);
    }
  );
  await setDataSource('fictional');
}
