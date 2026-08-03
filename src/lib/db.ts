import Dexie, { type Table } from 'dexie';
import type { PhysicalLocation, Panel, Issue, Replacement, ActivityEvent, Operator, Photo } from './types';

export class PanelManagerDB extends Dexie {
  locations!: Table<PhysicalLocation, string>;
  panels!: Table<Panel, string>;
  issues!: Table<Issue, string>;
  replacements!: Table<Replacement, string>;
  activityEvents!: Table<ActivityEvent, string>;
  operators!: Table<Operator, string>;
  photos!: Table<Photo, string>;

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
  }
}

export const db = new PanelManagerDB();
