// Data model. Field names follow the spec (PhysicalLocation / Panel / Issue / Replacement /
// ActivityEvent / Operator), with locationId/serialNumber shapes confirmed against the real
// file EDE-GRS-CM-RPT-3190-C1-UPDATED_MAPPING_07-06_FORMULAS.xlsx (sheet INFORME):
//   MODULE (row seq.) | BLOCK.INV.DCBOX.ARRAY.STRING.MODULE | SERIAL NUMBER | Pmp | Isc | Voc |
//   Imp | Vmp | Pnom | Pmp>Pnom | S/N(14) | watt class
// 377,888 rows = 13,496 strings x 28 modules/string, 36 blocks, 0 unparseable location codes.

export type IssueType =
  | 'broken_glass'
  | 'cracked_panel'
  | 'hotspot'
  | 'burn_mark'
  | 'junction_box_issue'
  | 'connector_or_cable_damage'
  | 'frame_damage'
  | 'delamination'
  | 'yellowing'
  | 'low_voltage'
  | 'no_output'
  | 'loose_or_missing_panel'
  | 'tracker_related_damage'
  | 'bypass_diode_activated' // added: #1 real cause in the "Replaced" sheet history (241/348 rows)
  | 'other';

export type Severity = 'low' | 'medium' | 'high' | 'immediate_safety_concern';

export type PanelStatus =
  | 'normal'
  | 'issue_reported'
  | 'under_assessment'
  | 'monitoring'
  | 'pending_replacement'
  | 'replaced'
  | 'closed';

export type IssueStatus =
  | 'open'
  | 'under_assessment'
  | 'monitoring'
  | 'pending_replacement'
  | 'replaced'
  | 'closed'
  | 'reopened';

export type SyncStatus = 'local' | 'pending' | 'synced' | 'conflict' | 'error';

export interface LocationCodeParts {
  block: number;
  inverter: number;
  dcBox: number;
  arrayBus: number;
  string: number;
  module: number; // 1-28, position within string. 1 = North end, 28 = South end.
}

export interface SimplePolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface PhysicalLocation {
  locationId: string; // stable id = "block.inverter.dcBox.arrayBus.string.module", e.g. "1.1.1.1.1.1"
  block: number;
  tracker?: string; // e.g. "01-067" -- filled once Tracker Finder geometry/enrichment is linked (Etapa 2)
  row?: string; // R1..R5, from Tracker Finder enrichment (Etapa 2)
  dcBox: string; // e.g. "DCB-1.1.1"
  arrayBus: string; // e.g. "AR-1.1.1.1"
  stringCode: string; // e.g. "S-1.1.1.1.1"
  positionInString: number; // 1-28
  orientation: 'N' | 'S' | 'unknown';
  geometry?: SimplePolygon; // panel-level polygon, derived from the string box (Etapa 2)
}

export interface PanelElectricalTest {
  pmpW?: number;
  iscA?: number;
  vocV?: number;
  impA?: number;
  vmpV?: number;
  wattClass?: number; // 535 | 540 | 545 ...
  grade?: string; // e.g. "535W-L"
  qcFlag?: string; // e.g. "OK" (INFORME column "Pmp>Pnom")
}

export interface Panel {
  panelId: string; // = locationId; the physical slot's id never changes even when the serial does
  serialNumber: string; // long form, e.g. "821029840209107321"
  serialNumberShort?: string; // short form, e.g. "29840209107321"
  voltage?: number; // Vmp (V) -- the "Voltage" field referenced throughout the spec
  locationId: string;
  status: PanelStatus;
  installDate?: string; // ISO date
  electrical?: PanelElectricalTest;
  sunManagerId?: string;
  extra?: Record<string, string | number | null>; // any other Excel columns detected on import
}

export interface Issue {
  issueId: string;
  locationId: string;
  panelIdAtReport: string;
  type: IssueType;
  severity: Severity;
  description: string;
  status: IssueStatus;
  reportedBy: string; // operatorId
  reportedDate: string; // ISO datetime, editable
  sunManagerId?: string;
  requiresReplacement: boolean;
  monitorOnly: boolean;
  immediateSafetyConcern: boolean;
  recommendedAction?: string;
  photoIds: string[];
  notes?: string;
  syncStatus: SyncStatus;
}

export interface Replacement {
  replacementId: string;
  locationId: string;
  removedPanelId: string;
  removedSerial: string;
  installedPanelId: string;
  installedSerial: string;
  oldVoltage?: number;
  newVoltage?: number;
  replacementDate: string; // ISO datetime
  replacedBy: string; // operatorId
  sunManagerId?: string;
  reason: string;
  relatedIssueId?: string;
  removedPanelDestination?: string;
  photoIds: string[];
  notes?: string;
  syncStatus: SyncStatus;
}

export interface ActivityEvent {
  eventId: string;
  entityType: 'panel' | 'issue' | 'replacement' | 'location' | 'operator';
  entityId: string;
  action: string; // e.g. "issue_created", "issue_status_changed", "replacement_confirmed", "correction"
  previousValue?: string;
  newValue?: string;
  operator: string; // operatorId
  timestamp: string; // ISO datetime
  syncStatus: SyncStatus;
  // Never delete history -- corrections are new events that reference the original.
  correctionOf?: string; // eventId being corrected
  correctionReason?: string;
}

export interface Operator {
  operatorId: string;
  name: string;
  active: boolean;
  role?: string;
}

export interface Photo {
  photoId: string;
  relatedType: 'issue' | 'replacement';
  relatedId: string;
  blob: Blob;
  takenAt: string;
  author: string; // operatorId
  description?: string;
  syncStatus: SyncStatus;
}
