import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExcelImportSession } from '@/lib/importRunner';
import { autoDetectMapping } from '@/lib/excelFields';
import { IMPORT_FIELDS, REQUIRED_IMPORT_FIELDS, type ColumnMapping, type ImportRow, type ImportSummary } from '@/lib/importTypes';
import { commitBatch, loadExistingPanelIndex, logImportEvent, newCommitStats, type CommitStats } from '@/lib/importCommit';
import { getDataSource, clearPanelData, setDataSource } from '@/lib/db';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';

type Step = 'pin' | 'select' | 'sheet' | 'header' | 'mapping' | 'confirmClear' | 'importing' | 'done';

const FIELD_LABELS: Record<string, string> = {
  locationCode: 'Location code (required)',
  serialNumber: 'Serial number (required)',
  serialNumberShort: 'Serial number (short)',
  voltage: 'Voltage (Vmp)',
  pmpW: 'Pmp (W)',
  iscA: 'Isc (A)',
  vocV: 'Voc (V)',
  impA: 'Imp (A)',
  grade: 'Grade / watt class',
  qcFlag: 'QC flag',
  sunManagerId: 'SunManager ID',
  installDate: 'Install date',
};

function guessHeaderRowIndex(rows: unknown[][]): number {
  let bestIdx = 0;
  let bestScore = -1;
  rows.forEach((row, idx) => {
    const score = row.filter((c) => typeof c === 'string' && c.trim().length > 0).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Import() {
  const navigate = useNavigate();
  const { operatorId } = useSession();
  const adminPin = useSettings((s) => s.adminPin);

  const [step, setStep] = useState<Step>(adminPin ? 'pin' : 'select');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const sessionRef = useRef<ExcelImportSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [previewRows, setPreviewRows] = useState<unknown[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [commitStats, setCommitStats] = useState<CommitStats>(newCommitStats());
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    return () => {
      sessionRef.current?.terminate();
    };
  }, []);

  function checkPin() {
    if (pinInput === adminPin) {
      setStep('select');
      setPinError(null);
    } else {
      setPinError('Incorrect PIN.');
    }
  }

  async function onFileSelected(file: File) {
    setError(null);
    setFileName(file.name);
    const session = new ExcelImportSession();
    sessionRef.current = session;
    try {
      const names = await session.listSheets(file);
      setSheets(names);
      setStep('sheet');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSheetSelected(name: string) {
    setError(null);
    setSelectedSheet(name);
    try {
      const { totalRows, previewRows } = await sessionRef.current!.parseSheet(name);
      setTotalRows(totalRows);
      setPreviewRows(previewRows);
      setHeaderRowIndex(guessHeaderRowIndex(previewRows));
      setStep('header');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function confirmHeaderRow() {
    const headers = (previewRows[headerRowIndex] ?? []).map((h) => String(h ?? '').trim());
    setMapping(autoDetectMapping(headers));
    setStep('mapping');
  }

  async function startImport() {
    const missing = REQUIRED_IMPORT_FIELDS.filter((f) => !Object.values(mapping).includes(f));
    if (missing.length > 0) {
      setError(`Map every required field first: ${missing.join(', ')}.`);
      return;
    }
    setError(null);
    const source = await getDataSource();
    if (source === 'fictional') {
      setStep('confirmClear');
    } else {
      runImportNow();
    }
  }

  async function clearThenImport() {
    await clearPanelData();
    await setDataSource('real');
    runImportNow();
  }

  async function runImportNow() {
    setStep('importing');
    setProgress({ processed: 0, total: totalRows });
    const stats = newCommitStats();
    setCommitStats(stats);
    try {
      const existingPanels = await loadExistingPanelIndex();
      const finalSummary = await sessionRef.current!.runImport(
        headerRowIndex,
        mapping,
        (batch: ImportRow[]) => {
          commitBatch(batch, existingPanels, stats).then(() => setCommitStats({ ...stats }));
        },
        (processed, total) => setProgress({ processed, total })
      );
      setSummary(finalSummary);
      if (operatorId) {
        await logImportEvent(
          operatorId,
          `${fileName}: ${finalSummary.okRows} ok, ${finalSummary.warningRows} warnings, ${finalSummary.errorRows} errors, ${stats.created} created, ${stats.updatedMasterData} updated, ${stats.serialMismatch} serial mismatches`
        );
      }
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const headerNames = (previewRows[headerRowIndex] ?? []).map((h) => String(h ?? '').trim()).filter(Boolean);

  return (
    <div className="pb-20">
      <h1 className="mb-4 text-lg font-semibold text-slate-100">Import Excel</h1>
      {error && <div className="mb-4 rounded-lg bg-status-pending/20 p-3 text-sm text-status-pending">{error}</div>}

      {step === 'pin' && (
        <div className="rounded-xl border border-border bg-bg-panel p-4">
          <p className="mb-3 text-sm text-slate-300">This action is protected by the admin PIN.</p>
          <div className="flex gap-2">
            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="PIN"
              className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
            />
            <button onClick={checkPin} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
              Unlock
            </button>
          </div>
          {pinError && <p className="mt-2 text-sm text-status-pending">{pinError}</p>}
        </div>
      )}

      {step === 'select' && (
        <div className="rounded-xl border border-border bg-bg-panel p-4">
          <p className="mb-3 text-sm text-slate-400">
            Select the panels Excel (.xlsx). Large files (tens of MB, hundreds of thousands of rows) are
            parsed in a background thread so the app stays responsive -- this can still take a little
            while.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])}
            className="text-sm text-slate-300"
          />
        </div>
      )}

      {step === 'sheet' && (
        <div className="rounded-xl border border-border bg-bg-panel p-4">
          <p className="mb-3 text-sm text-slate-400">
            {fileName} -- pick the sheet that holds the panel data (the real farm export uses "INFORME").
          </p>
          <div className="flex flex-col gap-2">
            {sheets.map((s) => (
              <button
                key={s}
                onClick={() => onSheetSelected(s)}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-left text-sm text-slate-100 hover:border-accent-blue"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'header' && (
        <div className="rounded-xl border border-border bg-bg-panel p-4">
          <p className="mb-3 text-sm text-slate-400">
            {totalRows.toLocaleString()} rows in "{selectedSheet}". Click the row that has the column
            names (pre-selected: our best guess).
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr
                    key={idx}
                    onClick={() => setHeaderRowIndex(idx)}
                    className={`cursor-pointer border-t border-border ${
                      idx === headerRowIndex ? 'bg-accent-blue/20' : 'hover:bg-bg-raised'
                    }`}
                  >
                    <td className="px-2 py-1 text-slate-500">{idx + 1}</td>
                    {row.slice(0, 8).map((cell, ci) => (
                      <td key={ci} className="px-2 py-1 text-slate-300">
                        {String(cell ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={confirmHeaderRow}
            className="mt-3 rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white"
          >
            Use row {headerRowIndex + 1} as header
          </button>
        </div>
      )}

      {step === 'mapping' && (
        <div className="rounded-xl border border-border bg-bg-panel p-4">
          <p className="mb-3 text-sm text-slate-400">
            Map each column to a field, or leave it as "Ignore". Detected automatically where possible --
            double check before continuing.
          </p>
          <div className="flex flex-col gap-2">
            {headerNames.map((header) => (
              <div key={header} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <span className="truncate text-sm text-slate-300" title={header}>
                  {header}
                </span>
                <select
                  value={mapping[header] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [header]: (e.target.value || null) as any })}
                  className="rounded-lg border border-border bg-bg px-2 py-1 text-sm text-slate-100"
                >
                  <option value="">Ignore</option>
                  {IMPORT_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button onClick={startImport} className="mt-3 rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
            Validate &amp; import {totalRows.toLocaleString()} rows
          </button>
        </div>
      )}

      {step === 'confirmClear' && (
        <div className="rounded-xl border border-border bg-bg-panel p-4">
          <p className="mb-3 text-sm text-status-observation">
            This device still has the Etapa 0 fictional test data loaded (its location codes overlap real
            block/string numbers). It needs to be cleared before importing the real farm data -- operators
            are kept.
          </p>
          <div className="flex gap-2">
            <button onClick={clearThenImport} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
              Clear test data &amp; import
            </button>
            <button onClick={() => setStep('mapping')} className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="rounded-xl border border-border bg-bg-panel p-4">
          <p className="mb-2 text-sm text-slate-300">
            Processing {progress.processed.toLocaleString()} / {progress.total.toLocaleString()} rows...
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
            <div
              className="h-full bg-accent-blue transition-all"
              style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
            <div>Created: {commitStats.created}</div>
            <div>Updated: {commitStats.updatedMasterData}</div>
            <div>Serial mismatch: {commitStats.serialMismatch}</div>
            <div>Skipped: {commitStats.skipped}</div>
          </div>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-bg-panel p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-200">Import finished</h2>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-300 sm:grid-cols-3">
              <div>Total rows: {summary.totalDataRows.toLocaleString()}</div>
              <div>OK: {summary.okRows.toLocaleString()}</div>
              <div>Warnings: {summary.warningRows.toLocaleString()}</div>
              <div>Errors (rejected): {summary.errorRows.toLocaleString()}</div>
              <div>Duplicate serials: {summary.duplicateSerialCount}</div>
              <div>Duplicate locations: {summary.duplicateLocationCount}</div>
              <div>Strings without 28 panels: {summary.incompleteStringGroups}</div>
              <div>Created: {commitStats.created}</div>
              <div>Master data updated: {commitStats.updatedMasterData}</div>
              <div>Serial mismatches (not applied): {commitStats.serialMismatch}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.errorRows > 0 && (
                <button
                  onClick={() => downloadText('rejected-rows.csv', summary.rejectedCsv)}
                  className="rounded-lg border border-border px-3 py-2 text-xs text-slate-300"
                >
                  Download rejected rows CSV
                </button>
              )}
              {commitStats.mismatches.length > 0 && (
                <button
                  onClick={() =>
                    downloadText(
                      'serial-mismatches.csv',
                      'locationId,recordedSerial,excelSerial\n' +
                        commitStats.mismatches.map((m) => `${m.locationId},${m.recordedSerial},${m.excelSerial}`).join('\n')
                    )
                  }
                  className="rounded-lg border border-border px-3 py-2 text-xs text-slate-300"
                >
                  Download serial mismatches CSV
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate('/')} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
              Go to Dashboard
            </button>
            <button onClick={() => navigate('/records')} className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300">
              Go to Records
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
