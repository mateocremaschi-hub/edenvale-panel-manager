import * as XLSX from 'xlsx';
import {
  parseLocationCode,
  buildLocationId,
  buildStringCode,
  buildArrayBusCode,
  buildDcBoxCode,
} from '../lib/locationCode';
import type { WorkerRequest, WorkerResponse, ColumnMapping, ImportRow, ImportSummary } from '../lib/importTypes';

// Typed loosely on purpose: mixing the "DOM" and "WebWorker" TS lib sets in one project
// causes duplicate-identifier errors, and this file only needs postMessage/onmessage.
const ctx: any = self;

const BATCH_SIZE = 5000;

// Cached across messages within one wizard session (one file selection = one Worker instance).
let cachedBuffer: ArrayBuffer | null = null;
let cachedSheetName: string | null = null;
let cachedRows: unknown[][] | null = null; // array-of-arrays, row 0 = first row of the sheet

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'listSheets') {
      cachedBuffer = msg.buffer;
      const wb = XLSX.read(cachedBuffer, { bookSheets: true });
      post({ type: 'sheets', requestId: msg.requestId, names: wb.SheetNames });
      return;
    }

    if (msg.type === 'parseSheet') {
      if (!cachedBuffer) throw new Error('No file loaded yet.');
      const wb = XLSX.read(cachedBuffer, {
        sheets: msg.sheetName,
        dense: true,
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
      });
      const ws = wb.Sheets[msg.sheetName];
      if (!ws) throw new Error(`Sheet "${msg.sheetName}" not found.`);
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
      cachedSheetName = msg.sheetName;
      cachedRows = rows;
      post({
        type: 'sheetParsed',
        requestId: msg.requestId,
        totalRows: rows.length,
        previewRows: rows.slice(0, 25),
      });
      return;
    }

    if (msg.type === 'runImport') {
      if (!cachedRows || !cachedSheetName) throw new Error('Parse a sheet before importing.');
      runImport(cachedRows, msg.headerRowIndex, msg.mapping, msg.requestId);
      return;
    }
  } catch (err) {
    post({ type: 'error', requestId: msg.requestId, message: err instanceof Error ? err.message : String(err) });
  }
};

function runImport(rows: unknown[][], headerRowIndex: number, mapping: ColumnMapping, requestId: string) {
  const headerRow = rows[headerRowIndex] ?? [];
  const colIndex: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    const name = String(h ?? '').trim();
    if (name) colIndex[name] = i;
  });

  // Resolve each mapped internal field to a column index (skip unmapped/"Ignore" columns).
  const fieldCol: Record<string, number> = {};
  for (const [header, field] of Object.entries(mapping)) {
    if (field && header in colIndex) fieldCol[field] = colIndex[header];
  }

  const dataRows = rows.slice(headerRowIndex + 1);
  const total = dataRows.length;

  const serialCounts = new Map<string, number>();
  const locationCounts = new Map<string, number>();
  const stringGroups = new Map<string, Set<number>>();

  const built: ImportRow[] = new Array(total);

  for (let i = 0; i < total; i++) {
    const row = dataRows[i];
    const rowNumber = headerRowIndex + 2 + i; // 1-based, +1 for header row itself
    const locationCodeRaw = fieldCol.locationCode !== undefined ? row[fieldCol.locationCode] : null;
    const serialRaw = fieldCol.serialNumber !== undefined ? row[fieldCol.serialNumber] : null;

    const issues: string[] = [];
    let status: 'ok' | 'warning' | 'error' = 'ok';

    const locationCodeStr = toStringOrNull(locationCodeRaw);
    const parts = locationCodeStr ? parseLocationCode(locationCodeStr) : null;
    let locationId: string | null = null;
    let block: number | null = null;
    let dcBox: string | null = null;
    let arrayBus: string | null = null;
    let stringCode: string | null = null;
    let positionInString: number | null = null;

    if (!locationCodeStr) {
      issues.push('Missing location code');
      status = 'error';
    } else if (!parts) {
      issues.push(`Unparseable location code "${locationCodeStr}"`);
      status = 'error';
    } else {
      locationId = buildLocationId(parts);
      block = parts.block;
      dcBox = buildDcBoxCode(parts);
      arrayBus = buildArrayBusCode(parts);
      stringCode = buildStringCode(parts);
      positionInString = parts.module;
      if (parts.module < 1 || parts.module > 28) {
        issues.push(`Position ${parts.module} out of range 1-28`);
        status = 'error';
      }
    }

    const serialNumber = toStringOrNull(serialRaw);
    if (!serialNumber) {
      issues.push('Missing serial number');
      status = 'error';
    }

    if (serialNumber) serialCounts.set(serialNumber, (serialCounts.get(serialNumber) ?? 0) + 1);
    if (locationId) locationCounts.set(locationId, (locationCounts.get(locationId) ?? 0) + 1);
    if (stringCode && positionInString !== null && status !== 'error') {
      if (!stringGroups.has(stringCode)) stringGroups.set(stringCode, new Set());
      stringGroups.get(stringCode)!.add(positionInString);
    }

    const voltageRaw = fieldCol.voltage !== undefined ? row[fieldCol.voltage] : null;
    const voltage = toNumberOrNull(voltageRaw);
    if (voltageRaw !== null && voltageRaw !== undefined && voltageRaw !== '' && voltage === null) {
      issues.push('Voltage has an invalid format (left blank)');
      if (status === 'ok') status = 'warning';
    }

    built[i] = {
      rowNumber,
      locationId,
      block,
      dcBox,
      arrayBus,
      stringCode,
      positionInString,
      serialNumber,
      serialNumberShort: toStringOrNull(fieldCol.serialNumberShort !== undefined ? row[fieldCol.serialNumberShort] : null),
      voltage,
      pmpW: toNumberOrNull(fieldCol.pmpW !== undefined ? row[fieldCol.pmpW] : null),
      iscA: toNumberOrNull(fieldCol.iscA !== undefined ? row[fieldCol.iscA] : null),
      vocV: toNumberOrNull(fieldCol.vocV !== undefined ? row[fieldCol.vocV] : null),
      impA: toNumberOrNull(fieldCol.impA !== undefined ? row[fieldCol.impA] : null),
      grade: toStringOrNull(fieldCol.grade !== undefined ? row[fieldCol.grade] : null),
      qcFlag: toStringOrNull(fieldCol.qcFlag !== undefined ? row[fieldCol.qcFlag] : null),
      sunManagerId: toStringOrNull(fieldCol.sunManagerId !== undefined ? row[fieldCol.sunManagerId] : null),
      installDate: toStringOrNull(fieldCol.installDate !== undefined ? row[fieldCol.installDate] : null),
      status,
      issues,
    };
  }

  // Second pass: duplicates + incomplete string groups (needs the full counts from pass one).
  let duplicateSerialCount = 0;
  for (const [, c] of serialCounts) if (c > 1) duplicateSerialCount++;
  let duplicateLocationCount = 0;
  for (const [, c] of locationCounts) if (c > 1) duplicateLocationCount++;
  let incompleteStringGroups = 0;
  for (const [, set] of stringGroups) if (set.size !== 28) incompleteStringGroups++;

  const rejectedLines: string[] = ['rowNumber,locationCode,serialNumber,issues'];

  for (let i = 0; i < built.length; i++) {
    const row = built[i];
    if (row.serialNumber && (serialCounts.get(row.serialNumber) ?? 0) > 1) {
      row.issues.push('Duplicate serial number');
      row.status = 'error';
    }
    if (row.locationId && (locationCounts.get(row.locationId) ?? 0) > 1) {
      row.issues.push('Duplicate location');
      row.status = 'error';
    }
    if (row.stringCode && row.status !== 'error') {
      const set = stringGroups.get(row.stringCode);
      if (set && set.size !== 28) {
        row.issues.push(`String has ${set.size} valid panel(s) instead of 28`);
        if (row.status === 'ok') row.status = 'warning';
      }
    }
    if (row.status === 'error') {
      rejectedLines.push(
        [String(row.rowNumber), csvEscape(row.locationId ?? ''), csvEscape(row.serialNumber ?? ''), csvEscape(row.issues.join('; '))].join(
          ','
        )
      );
    }
  }

  // Stream batches now that every row's final status is known.
  let okRows = 0;
  let warningRows = 0;
  let errorRows = 0;
  for (let i = 0; i < built.length; i += BATCH_SIZE) {
    const batch = built.slice(i, i + BATCH_SIZE);
    for (const r of batch) {
      if (r.status === 'ok') okRows++;
      else if (r.status === 'warning') warningRows++;
      else errorRows++;
    }
    post({ type: 'importBatch', requestId, batch });
    post({ type: 'importProgress', requestId, processed: Math.min(i + BATCH_SIZE, built.length), total: built.length });
  }

  const summary: ImportSummary = {
    totalDataRows: total,
    okRows,
    warningRows,
    errorRows,
    duplicateSerialCount,
    duplicateLocationCount,
    incompleteStringGroups,
    rejectedCsv: rejectedLines.join('\n'),
  };
  post({ type: 'importDone', requestId, summary });
}
