import type { WorkerRequest, WorkerResponse, ColumnMapping, ImportRow, ImportSummary } from './importTypes';

interface PendingResolvers {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  onBatch?: (batch: ImportRow[]) => void;
  onProgress?: (processed: number, total: number) => void;
}

/**
 * One ExcelImportSession = one Worker instance, reused across the whole wizard
 * (listSheets -> parseSheet -> runImport) so the file is only read once. Call
 * terminate() when the wizard closes/cancels.
 */
export class ExcelImportSession {
  private worker: Worker;
  private pending = new Map<string, PendingResolvers>();

  constructor() {
    this.worker = new Worker(new URL('../workers/excelImportWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data);
  }

  private handleMessage(msg: WorkerResponse) {
    const p = this.pending.get(msg.requestId);
    switch (msg.type) {
      case 'error':
        p?.reject(new Error(msg.message));
        this.pending.delete(msg.requestId);
        break;
      case 'sheets':
        p?.resolve(msg.names);
        this.pending.delete(msg.requestId);
        break;
      case 'sheetParsed':
        p?.resolve({ totalRows: msg.totalRows, previewRows: msg.previewRows });
        this.pending.delete(msg.requestId);
        break;
      case 'importBatch':
        p?.onBatch?.(msg.batch);
        break;
      case 'importProgress':
        p?.onProgress?.(msg.processed, msg.total);
        break;
      case 'importDone':
        p?.resolve(msg.summary);
        this.pending.delete(msg.requestId);
        break;
    }
  }

  private newRequestId(): string {
    return crypto.randomUUID();
  }

  async listSheets(file: File): Promise<string[]> {
    const buffer = await file.arrayBuffer();
    const requestId = this.newRequestId();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const req: WorkerRequest = { type: 'listSheets', requestId, buffer };
      this.worker.postMessage(req, [buffer]);
    });
  }

  async parseSheet(sheetName: string): Promise<{ totalRows: number; previewRows: unknown[][] }> {
    const requestId = this.newRequestId();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      const req: WorkerRequest = { type: 'parseSheet', requestId, sheetName };
      this.worker.postMessage(req);
    });
  }

  async runImport(
    headerRowIndex: number,
    mapping: ColumnMapping,
    onBatch: (batch: ImportRow[]) => void,
    onProgress: (processed: number, total: number) => void
  ): Promise<ImportSummary> {
    const requestId = this.newRequestId();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onBatch, onProgress });
      const req: WorkerRequest = { type: 'runImport', requestId, headerRowIndex, mapping };
      this.worker.postMessage(req);
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
