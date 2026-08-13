import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db, clearPanelData, setDataSource } from '@/lib/db';
import { useSettings } from '@/store/settings';
import { useSession } from '@/store/session';
import { newId } from '@/lib/id';
import { hasSupabase } from '@/lib/supabase';
import { pushLocationsAndPanels, type SyncProgress } from '@/lib/sync';
import { parseHistoricalReplacementsFile, applyHistoricalReplacements, removeHistoricalReplacementRecords, findSuspectSerials, type HistoricalApplyResult, type HistoricalCleanupResult, type SuspectSerial } from '@/lib/historicalReplacements';

export default function Settings() {
  const operators = useLiveQuery(() => db.operators.toArray(), [], []);
  const { appName, setAppName, adminPin, setAdminPin, voltageMin, voltageMax, setVoltageRange } = useSettings();
  const { operatorId } = useSession();

  const [name, setName] = useState(appName);
  const [newOperator, setNewOperator] = useState('');
  const [pin, setPin] = useState('');
  const [vMin, setVMin] = useState(String(voltageMin));
  const [vMax, setVMax] = useState(String(voltageMax));
  const [pushProgress, setPushProgress] = useState<SyncProgress | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [histProgress, setHistProgress] = useState<{ done: number; total: number } | null>(null);
  const [histResult, setHistResult] = useState<HistoricalApplyResult | null>(null);
  const [histError, setHistError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<HistoricalCleanupResult | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<SuspectSerial[] | null>(null);

  async function handleAudit() {
    setAuditBusy(true);
    setAuditResult(null);
    try {
      const suspects = await findSuspectSerials((scanned, total) => setAuditStatus(`Scanning ${scanned.toLocaleString()} / ${total.toLocaleString()}...`));
      setAuditResult(suspects);
    } finally {
      setAuditBusy(false);
      setAuditStatus(null);
    }
  }

  async function handleCleanup() {
    setCleanupError(null);
    setCleanupResult(null);
    const confirmed = confirm(
      'This removes every replacement record created by an earlier run of "Apply historical replacements" (both on this device and on the shared server), WITHOUT touching the panel serial numbers those runs already corrected. Continue?'
    );
    if (!confirmed) return;
    setCleanupBusy(true);
    try {
      const result = await removeHistoricalReplacementRecords(setCleanupStatus);
      setCleanupResult(result);
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : String(err));
    } finally {
      setCleanupBusy(false);
      setCleanupStatus(null);
    }
  }

  async function handleHistoricalFile(file: File) {
    setHistError(null);
    setHistResult(null);
    setHistBusy(true);
    try {
      const rows = await parseHistoricalReplacementsFile(file);
      const confirmed = confirm(
        `Found ${rows.length} row(s) in this file. This will check each "before" serial against your current panels, and for every match, log a replacement and update that panel's serial to "after". Continue?`
      );
      if (!confirmed) {
        setHistBusy(false);
        return;
      }
      const result = await applyHistoricalReplacements(rows, operatorId!, (done, total) => setHistProgress({ done, total }));
      setHistResult(result);
    } catch (err) {
      setHistError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistBusy(false);
      setHistProgress(null);
    }
  }
  const [pushDone, setPushDone] = useState(false);

  async function handlePush() {
    setPushError(null);
    setPushDone(false);
    const confirmed = confirm(
      "This uploads every location and panel on THIS device to the shared Supabase project, so every other device can see the same real data. Only run this from the device that has the real imported Excel data. It can take a couple of minutes. Continue?"
    );
    if (!confirmed) return;
    try {
      await pushLocationsAndPanels(setPushProgress);
      setPushDone(true);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushProgress(null);
    }
  }

  async function addOperator() {
    const trimmed = newOperator.trim();
    if (!trimmed) return;
    await db.operators.add({ operatorId: newId('op'), name: trimmed, active: true });
    setNewOperator('');
  }

  async function toggleOperator(id: string, active: boolean) {
    await db.operators.update(id, { active: !active });
  }

  async function resetAllPanelData() {
    if (adminPin) {
      const entered = prompt('Enter admin PIN to reset all panel data:');
      if (entered !== adminPin) {
        alert('Incorrect PIN.');
        return;
      }
    }
    const confirmed = confirm(
      'This deletes ALL panels, locations, issues, replacements and activity history on THIS device/URL. Operators are kept. This cannot be undone. Continue?'
    );
    if (!confirmed) return;
    await clearPanelData();
    await setDataSource('empty');
    alert('Local panel data cleared. Fictional test data will reload next time the app starts, or go straight to Data import.');
  }

  return (
    <div className="flex flex-col gap-6 pb-20">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="text-xs text-slate-500">
          Build:{' '}
          {typeof __BUILD_TIME__ !== 'undefined' && __BUILD_TIME__
            ? new Date(__BUILD_TIME__).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
            : 'unknown (vite.config.ts wasn\'t updated in this deploy)'}
        </p>
      </div>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">App name</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button onClick={() => setAppName(name)} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Changes the name shown inside the app. The installed PWA icon name comes from the manifest and
          needs a rebuild + redeploy to change.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Operators</h2>
        <div className="flex flex-col gap-2">
          {(operators ?? []).map((op) => (
            <div key={op.operatorId} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className={op.active ? 'text-slate-100' : 'text-slate-500 line-through'}>{op.name}</span>
              <button onClick={() => toggleOperator(op.operatorId, op.active)} className="text-xs text-accent-blue">
                {op.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newOperator}
            onChange={(e) => setNewOperator(e.target.value)}
            placeholder="Full name"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button onClick={addOperator} className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-semibold text-bg-panel">
            Add
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Data import</h2>
        <p className="mb-3 text-xs text-slate-500">
          Import or re-import the panels Excel. Protected by the admin PIN above, if one is set.
        </p>
        <Link
          to="/import"
          className="inline-block rounded-lg bg-accent-teal px-4 py-2 text-sm font-semibold text-bg-panel"
        >
          Import Excel
        </Link>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Admin PIN</h2>
        <p className="mb-2 text-xs text-slate-500">
          Protects import, settings changes and voiding records. Leave blank to disable (Etapa 0 default).
        </p>
        <div className="flex gap-2">
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={adminPin ? '••••' : 'No PIN set'}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button onClick={() => setAdminPin(pin || null)} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
            Save
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Voltage validation range</h2>
        <div className="flex items-center gap-2">
          <input
            value={vMin}
            onChange={(e) => setVMin(e.target.value)}
            type="number"
            className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <span className="text-slate-500">to</span>
          <input
            value={vMax}
            onChange={(e) => setVMax(e.target.value)}
            type="number"
            className="w-24 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button
            onClick={() => setVoltageRange(Number(vMin), Number(vMax))}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Supabase sync</h2>
        {!hasSupabase() ? (
          <p className="text-xs text-slate-500">
            Not configured yet on this build. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as environment
            variables in Netlify, then redeploy.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              Uploads this device's locations + panels to the shared server, so any other device (like your
              phone) can download the real data automatically instead of importing the Excel again. Only
              needed once from the device with the real data -- safe to run again later if you re-import.
            </p>
            {pushError && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{pushError}</div>}
            {pushDone && <div className="mb-3 rounded-lg bg-status-replaced/20 p-2 text-xs text-status-replaced">Upload complete.</div>}
            {pushProgress ? (
              <div>
                <p className="mb-1 text-xs text-slate-400">
                  {pushProgress.phase}... {pushProgress.done.toLocaleString()} / {pushProgress.total.toLocaleString()}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
                  <div
                    className="h-full bg-accent-blue transition-all"
                    style={{ width: `${pushProgress.total ? (pushProgress.done / pushProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : (
              <button onClick={handlePush} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
                Push local data to Supabase
              </button>
            )}
          </>
        )}
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Apply historical replacements from Excel</h2>
        <p className="mb-3 text-xs text-slate-500">
          For panels that were swapped in the field before this app existed (or without being logged).
          Upload a file with "Serial Number (Before)" / "Serial Number (After)" columns -- for every
          "before" serial that matches a current panel, this quietly updates that panel to the "after"
          serial. This is a silent data correction: it does NOT create a visible replacement entry, and
          won't show up in the Replacements list, the PDF report, or the Dashboard's replacement counts.
          Serials that don't match anything current are left alone and listed below so you can check them.
        </p>
        {histError && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{histError}</div>}
        {histResult && (
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
            <div className="text-status-replaced">✓ {histResult.matched} panel(s) updated.</div>
            {histResult.vacated > 0 && (
              <div className="text-status-pending">
                ⚠ {histResult.vacated} row(s) had a non-serial "after" value (e.g. "To be installed") -- those panels
                were marked vacant instead of getting a fake serial.
              </div>
            )}
            {histResult.alreadyCurrent.length > 0 && (
              <div className="text-slate-400">{histResult.alreadyCurrent.length} row(s) already matched (no change needed).</div>
            )}
            {histResult.notFound.length > 0 && (
              <details>
                <summary className="cursor-pointer text-status-pending">
                  {histResult.notFound.length} "before" serial(s) not found among current panels
                </summary>
                <div className="mt-1 max-h-40 overflow-y-auto font-mono text-slate-400">
                  {histResult.notFound.join(', ')}
                </div>
              </details>
            )}
          </div>
        )}
        {histBusy ? (
          <p className="text-xs text-slate-400">
            {histProgress ? `Processing ${histProgress.done} / ${histProgress.total}...` : 'Reading file...'}
          </p>
        ) : (
          <label className="inline-block cursor-pointer rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
            Choose Excel file
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleHistoricalFile(e.target.files[0])}
            />
          </label>
        )}

        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs text-slate-500">
            Ran an earlier version of this tool that logged visible replacement entries instead of a
            silent update? Remove those entries here -- panel serials already corrected are left as-is.
          </p>
          {cleanupError && <div className="mb-2 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{cleanupError}</div>}
          {cleanupResult && (
            <div className="mb-2 text-xs text-status-replaced">
              ✓ Removed {cleanupResult.removedLocally} record(s) locally, {cleanupResult.removedRemotely} on the server.
            </div>
          )}
          {cleanupBusy ? (
            <p className="text-xs text-slate-400">{cleanupStatus || 'Working...'}</p>
          ) : (
            <button onClick={handleCleanup} className="rounded-lg border border-status-pending px-4 py-2 text-sm font-semibold text-status-pending">
              Remove historical import replacement entries
            </button>
          )}
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs text-slate-500">
            Scan every panel for a serial number that doesn't look real (blank, short text like "To be
            installed", etc.) -- whether from this tool or the original farm import. Doesn't change
            anything, just lists what it finds so you can review and fix each one on purpose.
          </p>
          {auditResult && (
            <div className="mb-2 rounded-lg border border-border p-3 text-xs">
              {auditResult.length === 0 ? (
                <div className="text-status-replaced">✓ No suspect serials found.</div>
              ) : (
                <>
                  <div className="mb-2 text-status-pending">⚠ {auditResult.length} panel(s) with a serial that doesn't look real:</div>
                  <div className="max-h-60 overflow-y-auto">
                    {auditResult.map((s) => (
                      <div key={s.locationId} className="flex justify-between border-t border-border py-1 font-mono">
                        <span>{s.locationId}</span>
                        <span className="text-slate-400">{s.serialNumber || '(blank)'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {auditBusy ? (
            <p className="text-xs text-slate-400">{auditStatus || 'Scanning...'}</p>
          ) : (
            <button onClick={handleAudit} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-slate-300">
              Scan for suspect serial numbers
            </button>
          )}
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs text-slate-500">
            Want to undo ALL historical-replacement Excel imports and go back to exactly what the
            original master farm export says?
          </p>
          <Link to="/restore-master" className="inline-block rounded-lg border border-status-pending px-4 py-2 text-sm font-semibold text-status-pending">
            Restore panel data from master Excel
          </Link>
        </div>
      </section>

      <section className="rounded-xl border border-status-pending/40 bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-status-pending">Danger zone</h2>
        <p className="mb-3 text-xs text-slate-500">
          Wipes all panels/locations/issues/replacements/history on this device/URL only (nothing on any
          other device is touched). Use this if an import ran on top of leftover test data by mistake.
          Operators are kept.
        </p>
        <button onClick={resetAllPanelData} className="rounded-lg border border-status-pending px-4 py-2 text-sm font-semibold text-status-pending">
          Reset all panel data
        </button>
      </section>

      <footer className="pt-2 text-center text-xs text-slate-600">Developed by Mateo Cremaschi</footer>
    </div>
  );
}
