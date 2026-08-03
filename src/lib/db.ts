import Dexie, { type Table } from 'dexie';
import type { PhysicalLocation, Panel, Issue, Replacement, ActivityEvent, Operator, Photo } from './types';

export interface MetaEntry {
  key: string;
  value: string;
}

export class PanelManagerDB extends Dexie {
  locations!: Table<PhysicalLocation, string>;
  panels!: Table<Panel, string>;
  issues!: Table<Issue, string>;
  replacements!: Table<Replacement, string>;
  activityEvents!: Table<ActivityEvent, string>;
  operators!: Table<Operator, string>;
  photos!: Table<Photo, string>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('edenvale-panel-manager');
    // Indexed fields are chosen to match the required search/filter axes (Rendimiento
    // section of the spec): serial, location, SunManager ID, status, dates for sorting.
    this.version(1).stores({
      locations: 'locationId, block',
      panels: 'panelId, locationId, serialNumber, serialNumberShort, sunManagerId, status',
      issues:
        'issueId, locationId, panelIdAtReport, status, type, reportedBy, reportedDate, sunManagerId, syncStatus',
      replacements:
        'replacementId, locationId, removedSerial, installedSerial, replacementDate, replacedBy, sunManagerId, syncStatus',
      activityEvents: 'eventId, entityType, entityId, timestamp, syncStatus',
      operators: 'operatorId, name, active',
      photos: 'photoId, relatedType, relatedId, syncStatus',
    });
    // v2 adds `meta` (key/value: tracks whether local data is the Etapa 0 fictional
    // seed or a real import, so the Import wizard can warn before overwriting it).
    this.version(2).stores({
      meta: 'key',
    });
  }
}

export const db = new PanelManagerDB();

export async function getDataSource(): Promise<'fictional' | 'real' | 'empty'> {
  const entry = await db.meta.get('dataSource');
  if (entry?.value === 'fictional' || entry?.value === 'real') return entry.value;
  return 'empty';
}

export async function setDataSource(value: 'fictional' | 'real') {
  await db.meta.put({ key: 'dataSource', value });
}

/**
 * Wipes all panel/location/issue/replacement/activity/photo data (used before the first
 * real import, to remove the Etapa 0 fictional seed so its location IDs -- which overlap
 * real block/string numbers -- don't collide with the real dataset). Operators are kept,
 * since the user may already have added real people to that list.
 */
export async function clearPanelData() {
  await db.transaction(
    'rw',
    db.locations,
    db.panels,
    db.issues,
    db.replacements,
    db.activityEvents,
    db.photos,
    async () => {
      await db.locations.clear();
      await db.panels.clear();
      await db.issues.clear();
      await db.replacements.clear();
      await db.activityEvents.clear();
      await db.photos.clear();
    }
  );
}
