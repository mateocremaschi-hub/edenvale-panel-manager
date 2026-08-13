import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExcelImportSession } from '@/lib/importRunner';
import { autoDetectMapping } from '@/lib/excelFields';
import { REQUIRED_IMPORT_FIELDS, type ColumnMapping, type ImportRow } from '@/lib/importTypes';
import { commitBatch, loadExistingPanelIndex, logImportEvent, newCommitStats, type CommitStats } from '@/lib/importCommit';
import { useSession } from '@/store/session';

type Step = 'select' | 'confirm' | 'running' | 'done';

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

/**
 * Recovery tool: re-reads the ORIGINAL master farm Excel and force-restores every matching
 * panel's serial number and status back to what that file says -- undoing whatever a later
 * historical-replacement Excel changed (including any "vacant" marks). Deliberately narrow:
 * touches only panels/locations, never issues/replacements/photos/activity events, so real
 * field work logged through the app day to day is never at risk. See Settings for the more
 * surgical "Apply historical replacements" tool this is meant to fully undo the effects of.
 */
export default function RestoreMaster() {
  const navigate = useNavigate();
  const { operatorId } = useSession();
  const sessionRef = useRef<ExcelImportSession | null>(null);

  const [step, setStep] = useState<Step>('select');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [stats, setStats] = useState<CommitStats>(newCommitStats());

  async function onFileSelected(file: File) {
    setError(null);
    setFileName(file.name);
    const session = new ExcelImportSession();
    sessionRef.current = session;
    try {
      const names = await session.listSheets(file);
      const sheetName = names[0];
      const { totalRows, previewRows } = await session.parseSheet(sheetName);
      const hIdx = guessHeaderRowIndex(previewRows);
      const headers = (previewRows[hIdx] ?? []).map((h) => String(h ?? '').trim());
      const detected = autoDetectMapping(headers);
      const missing = REQUIRED_IMPORT_FIELDS.filter((f) => !Object.values(detected).includes(f));
      if (missing.length > 0) {
        setError(`Could not auto-detect required columns (${missing.join(', ')}) in the first sheet of this file. Make sure it's the original master export.`);
        return;
      }
      setTotalRows(totalRows);
      setHeaderRowIndex(hIdx);
      setMapping(detected);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runRestore() {
    const confirmed = confirm(
      `This will scan all ${totalRows.toLocaleString()} rows and, for every panel whose current serial or status differs from this file, force it back to match -- undoing any historical-replacement Excel imports. It will NOT touch issues, replacements, or photos. This cannot be undone automatically. Continue?`
    );
    if (!confirmed) return;

    setStep('running');
    setProgress({ processed: 0, total: totalRows });
    const s = newCommitStats();
    setStats(s);
    try {
      const existingPanels = await loadExistingPanelIndex();
      const finalSummary = await sessionRef.current!.runImport(
        headerRowIndex,
        mapping,
        (batch: ImportRow[]) => {
          commitBatch(batch, existingPanels, s, { force: true }).then(() => setStats({ ...s }));
        },
        (processed, total) => setProgress({ processed, total })
      );
      if (operatorId) {
        await logImportEvent(
          operatorId,
          `Restore from master Excel (${fileName}): ${finalSummary.okRows} ok rows, ${s.restored} panel(s) forced back to match, ${s.unchanged + s.updatedMasterData} already matched`
        );
      }
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('confirm');
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-lg font-semibold text-slate-100">Restore panel data from master Excel</h1>
      <p className="mb-4 text-sm text-slate-400">
        Undoes the effect of any historical-replacement Excel imports (including "vacant" marks), by
        forcing every panel's serial number and status back to whatever your original master farm
        export says. Only touches panels and locations -- issues, replacements, and photos logged
        through normal use of the app are never affected.
      </p>

      {error && <div className="mb-4 rounded-lg bg-status-pending/20 p-3 text-sm text-status-pending">{error}</div>}

      {step === 'select' && (
        <label className="inline-block cursor-pointer rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
          Choose master Excel file
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])} />
        </label>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-bg-panel p-4 text-sm text-slate-300">
            <div>
              File: <span className="font-mono">{fileName}</span>
            </div>
            <div>{totalRows.toLocaleString()} rows detected, columns auto-mapped.</div>
          </div>
          <button onClick={runRestore} className="self-start rounded-lg bg-status-pending px-4 py-2 text-sm font-semibold text-white">
            Force restore from this file
          </button>
        </div>
      )}

      {step === 'running' && (
        <div>
          <p className="mb-2 text-sm text-slate-400">
            Processing {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}...
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-panel">
            <div
              className="h-full bg-accent-blue transition-all"
              style={{ width: `${progress.total ? (progress.processed / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-status-replaced/40 bg-status-replaced/10 p-4 text-sm text-status-replaced">
            ✓ Done. {stats.restored} panel(s) restored to the master file's values. {stats.updatedMasterData + stats.unchanged} were
            already matching. {stats.created} new location(s) created.
          </div>
          <p className="text-xs text-slate-500">
            This device's data is now restored. Push it to the shared server from Settings so other devices
            get it on their next sync.
          </p>
          <button onClick={() => navigate('/settings')} className="self-start rounded-lg border border-border px-4 py-2 text-sm text-slate-300">
            Back to Settings
          </button>
        </div>
      )}
    </div>
  );
}
