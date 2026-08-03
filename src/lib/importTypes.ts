// Shared between src/workers/excelImportWorker.ts and the Import wizard pages.
// Kept dependency-free (no Dexie/React imports) so the worker can import it too.

export const IMPORT_FIELDS = [
  'locationCode',
  'serialNumber',
  'serialNumberShort',
  'voltage',
  'pmpW',
  'iscA',
  'vocV',
  'impA',
  'grade',
  'qcFlag',
  'sunManagerId',
  'installDate',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_IMPORT_FIELDS: ImportField[] = ['locationCode', 'serialNumber'];

// header name (as it appears in the sheet) -> internal field, or null to ignore that column
export type ColumnMapping = Record<string, ImportField | null>;

export interface ImportRow {
  rowNumber: number; // 1-based Excel row number, for error reporting
  locationId: string | null;
  block: number | null;
  dcBox: string | null;
  arrayBus: string | null;
  stringCode: string | null;
  positionInString: number | null;
  serialNumber: string | null;
  serialNumberShort: string | null;
  voltage: number | null;
  pmpW: number | null;
  iscA: number | null;
  vocV: number | null;
  impA: number | null;
  grade: string | null;
  qcFlag: string | null;
  sunManagerId: string | null;
  installDate: string | null;
  status: 'ok' | 'warning' | 'error';
  issues: string[];
}

export interface ImportSummary {
  totalDataRows: number;
  okRows: number;
  warningRows: number;
  errorRows: number;
  duplicateSerialCount: number;
  duplicateLocationCount: number;
  incompleteStringGroups: number;
  rejectedCsv: string; // rows with status 'error', as downloadable CSV text
}

export type WorkerRequest =
  | { type: 'listSheets'; requestId: string; buffer: ArrayBuffer }
  | { type: 'parseSheet'; requestId: string; sheetName: string }
  | { type: 'runImport'; requestId: string; headerRowIndex: number; mapping: ColumnMapping };

export type WorkerResponse =
  | { type: 'sheets'; requestId: string; names: string[] }
  | { type: 'sheetParsed'; requestId: string; totalRows: number; previewRows: unknown[][] }
  | { type: 'importProgress'; requestId: string; processed: number; total: number }
  | { type: 'importBatch'; requestId: string; batch: ImportRow[] }
  | { type: 'importDone'; requestId: string; summary: ImportSummary }
  | { type: 'error'; requestId: string; message: string };
