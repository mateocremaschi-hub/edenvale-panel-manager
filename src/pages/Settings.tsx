import { activeProjectConfig } from '@/store/project';
import { useEffect, useState } from 'react';
import { changeOwnPassword, listProfiles, signOut, updateProfile, type Profile, type Role } from '@/lib/auth';
import { loadWattsFromMasterExcel } from '@/lib/wattsFromExcel';
import type { WattsEnrichmentStats } from '@/lib/wattsEnrichment';
import { requireAdminPin } from '@/lib/adminPin';
import { Link } from 'react-router-dom';
import { db, clearPanelData, setDataSource } from '@/lib/db';
import { useSettings } from '@/store/settings';
import { useSession } from '@/store/session';
import { hasSupabase } from '@/lib/supabase';
import { pushLocationsAndPanels, type SyncProgress } from '@/lib/sync';
import { parseHistoricalReplacementsFile, applyHistoricalReplacements, removeHistoricalReplacementRecords, findSuspectSerials, type HistoricalApplyResult, type HistoricalCleanupResult, type SuspectSerial, type HistoricalRow } from '@/lib/historicalReplacements';
import { logImportEvent } from '@/lib/importCommit';

export default function Settings() {
  const { appName, setAppName, adminPin, setAdminPin } = useSettings();
  const [wattsBusy, setWattsBusy] = useState(false);
  const [wattsProgress, setWattsProgress] = useState<string | null>(null);
  const [wattsResult, setWattsResult] = useState<WattsEnrichmentStats | null>(null);
  const [wattsError, setWattsError] = useState<string | null>(null);
  const { operatorId, operatorName, role, clearOperator } = useSession();
  const [users, setUsers] = useState<Profile[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);

  async function refreshUsers() {
    setUsersError(null);
    try {
      setUsers(await listProfiles());
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : String(err));
    }
  }
  useEffect(() => {
    if (role === 'admin') refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function setUserRole(userId: string, newRole: Role) {
    try {
      await updateProfile(userId, { role: newRole });
      await refreshUsers();
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onWattsFile(file: File) {
    if (!(await requireAdminPin(adminPin, setAdminPin))) return;
    setWattsBusy(true);
    setWattsError(null);
    setWattsResult(null);
    try {
      const stats = await loadWattsFromMasterExcel(file, (phase, done, total) => {
        setWattsProgress(total > 0 ? `${phase}: ${done.toLocaleString()} / ${total.toLocaleString()}` : phase);
      });
      setWattsResult(stats);
      if (operatorId) {
        await logImportEvent(
          operatorId,
          `Watts loaded from ${file.name}: ${stats.panelsUpdated} panels updated, ${stats.panelsUnchanged} already correct, ${stats.panelsNotInExcel} not in Excel${stats.pushFailed ? ' -- PUSH FAILED (saved locally only)' : ''}`
        );
      }
    } catch (err) {
      setWattsError(err instanceof Error ? err.message : String(err));
    } finally {
      setWattsBusy(false);
      setWattsProgress(null);
    }
  }

  const [name, setName] = useState(appName);
  const [pushProgress, setPushProgress] = useState<SyncProgress | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [histProgress, setHistProgress] = useState<{ done: number; total: number } | null>(null);
  const [histResult, setHistResult] = useState<HistoricalApplyResult | null>(null);
  const [histError, setHistError] = useState<string | null>(null);
  const [histPreviewRows, setHistPreviewRows] = useState<HistoricalRow[] | null>(null);
  const [histPreviewChecks, setHistPreviewChecks] = useState<Record<number, string> | null>(null);

  async function handleHistoricalPreview(file: File) {
    setHistError(null);
    setHistResult(null);
    setHistPreviewRows(null);
    setHistPreviewChecks(null);
    try {
      const rows = await parseHistoricalReplacementsFile(file);
      const sample = rows.slice(0, 10);
      setHistPreviewRows(sample);
      // For each sample row, check right now whether "before" actually matches a current
      // panel -- and if not, whether that panel exists ANYWHERE under a slightly different
      // (trimmed/case-insensitive) value, so a formatting mismatch is obvious immediately
      // instead of guessing blind again.
      const checks: Record<number, string> = {};
      for (let i = 0; i < sample.length; i++) {
        const exactBefore = await db.panels.where('serialNumber').equals(sample[i].before).first();
        const exactAfter = await db.panels.where('serialNumber').equals(sample[i].after).first();
        const parts: string[] = [];
        if (exactBefore) {
          parts.push(`before ✓ found at ${exactBefore.locationId}`);
        } else {
          const similar = await db.panels.where('serialNumber').startsWithIgnoreCase(sample[i].before.slice(0, 6)).limit(1).toArray();
          parts.push(similar.length > 0 ? `before ✗ not found -- similar: "${similar[0].serialNumber}"` : 'before ✗ not found anywhere');
        }
        if (exactAfter) {
          parts.push(`after ✓ already at ${exactAfter.locationId}`);
        } else {
          parts.push('after ✗ not found anywhere either');
        }
        checks[i] = parts.join(' · ');
      }
      setHistPreviewChecks(checks);
      setHistFile(file);
    } catch (err) {
      setHistError(err instanceof Error ? err.message : String(err));
    }
  }
  const [histFile, setHistFile] = useState<File | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<HistoricalCleanupResult | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<SuspectSerial[] | null>(null);

  async function handleAudit() {
    if (!(await requireAdminPin(adminPin, setAdminPin))) return;
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
    if (!(await requireAdminPin(adminPin, setAdminPin))) return;
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
    if (!(await requireAdminPin(adminPin, setAdminPin))) return;
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
      setHistPreviewRows(null);
      setHistPreviewChecks(null);
      if (operatorId) {
        await logImportEvent(
          operatorId,
          `Apply historical replacements (${file.name}): ${result.matched} matched, ${result.vacated} marked vacant, ${result.relocatedFrom} relocated-from, ${result.notFound.length} not found`
        );
      }
    } catch (err) {
      setHistError(err instanceof Error ? err.message : String(err));
    } finally {
      setHistBusy(false);
      setHistProgress(null);
    }
  }
  const [pushDone, setPushDone] = useState(false);

  async function handlePush() {
    if (!(await requireAdminPin(adminPin, setAdminPin))) return;
    setPushError(null);
    setPushDone(false);
    const confirmed = confirm(
      "⚠ This OVERWRITES every location and panel on the shared server with whatever is on THIS device right now -- including wiping out any newer changes other devices or historical Excel imports have already pushed, if this device's local copy doesn't have them too. Only use this for the very first setup, or if you've just confirmed (e.g. via Records → Vacant) that THIS device's data is the most complete and correct version. When in doubt, use \"Re-download all locations & panels\" on the Sync page instead -- that pulls the server's data down, it never pushes local data up. Continue?"
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

  async function resetAllPanelData() {
    if (!(await requireAdminPin(adminPin, setAdminPin, 'Enter admin PIN to reset all panel data:'))) return;
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
        <h1 className="font-display text-xl font-bold tracking-tight text-slate-50">Settings</h1>
        <p className="text-xs text-slate-500">
          Build:{' '}
          {typeof __BUILD_TIME__ !== 'undefined' && __BUILD_TIME__
            ? new Date(__BUILD_TIME__).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
            : 'unknown (vite.config.ts wasn\'t updated in this deploy)'}
        </p>
      </div>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-200">Project</h2>
        <p className="text-sm text-slate-300">{activeProjectConfig().name}</p>
        <p className="mb-2 text-xs text-slate-500">This device works on one project at a time; its data, maps and backend are separate from other farms.</p>
        <Link to="/projects" className="text-xs font-semibold text-accent-blue underline">Switch project</Link>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">App name</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button
            onClick={async () => {
              if (!(await requireAdminPin(adminPin, setAdminPin))) return;
              setAppName(name);
            }}
            className="rounded-lg btn-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Changes the name shown inside the app. The installed PWA icon name comes from the manifest and
          needs a rebuild + redeploy to change.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-200">Account</h2>
        <p className="text-sm text-slate-300">
          {operatorName} <span className="text-xs text-slate-500">· {role ?? 'no role'}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={async () => {
              const pw = prompt('New password (at least 8 characters):');
              if (!pw) return;
              if (pw.length < 8) return alert('At least 8 characters.');
              try {
                await changeOwnPassword(pw);
                alert('Password changed.');
              } catch (err) {
                alert(err instanceof Error ? err.message : String(err));
              }
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300"
          >
            Change my password
          </button>
          <button
            onClick={async () => {
              await signOut();
              clearOperator();
            }}
            className="rounded-lg border border-status-pending/50 px-4 py-2 text-sm text-status-pending"
          >
            Sign out
          </button>
        </div>
      </section>

      {role === 'admin' && (
        <section className="rounded-xl border border-border bg-bg-panel p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Users</h2>
          <p className="mb-3 text-xs text-slate-500">
            Accounts are created in the Supabase dashboard (Authentication → Users → Add user) for this project's
            backend. Set each person's role here: <b>technician</b> (this farm only), <b>coordinator</b> (any farm they
            have an account in) or <b>admin</b> (users + data tools). A user shows up here after their first sign-in, or
            once the database trigger creates their profile.
          </p>
          <div className="mb-2 flex gap-2">
            <button onClick={refreshUsers} className="rounded-lg border border-border px-3 py-1.5 text-xs text-slate-300">
              Refresh
            </button>
            {usersError && <span className="text-xs text-status-pending">{usersError}</span>}
          </div>
          <div className="flex flex-col gap-2">
            {users.map((u) => (
              <div key={u.userId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className={u.active ? 'text-sm text-slate-100' : 'text-sm text-slate-500 line-through'}>{u.displayName}</div>
                  <div className="text-[11px] text-slate-500">{u.email ?? '-'}</div>
                </div>
                <select
                  value={u.role}
                  disabled={u.userId === operatorId}
                  onChange={(e) => setUserRole(u.userId, e.target.value as Role)}
                  className="rounded border border-border bg-bg px-2 py-1 text-xs text-slate-100 disabled:opacity-50"
                  title={u.userId === operatorId ? "You can't change your own role" : ''}
                >
                  <option value="technician">technician</option>
                  <option value="coordinator">coordinator</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  onClick={() => {
                    const name = prompt('Display name:', u.displayName);
                    if (name && name.trim()) updateProfile(u.userId, { displayName: name.trim() }).then(refreshUsers).catch((e) => setUsersError(String(e)));
                  }}
                  className="text-xs text-accent-blue"
                >
                  Rename
                </button>
                <button
                  onClick={() => updateProfile(u.userId, { active: !u.active }).then(refreshUsers).catch((e) => setUsersError(String(e)))}
                  disabled={u.userId === operatorId}
                  className="text-xs text-accent-blue disabled:opacity-40"
                >
                  {u.active ? 'Disable' : 'Enable'}
                </button>
              </div>
            ))}
            {users.length === 0 && <div className="text-xs text-slate-500">No users loaded yet.</div>}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Data import</h2>
        <p className="mb-3 text-xs text-slate-500">
          Import or re-import the panels Excel. Admin only.
        </p>
        <Link
          to="/import"
          className="inline-block rounded-lg bg-accent-teal px-4 py-2 text-sm font-semibold text-bg-panel"
        >
          Import Excel
        </Link>
      </section>


      <section className="rounded-xl border border-accent-amber/40 bg-bg-panel p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-200">Load panel Watts from master Excel</h2>
        <p className="mb-3 text-xs text-slate-400">
          One step: pick the master panels Excel and it fills in every panel's watt class (535 / 540 / 545) from the
          "Pnom (W)" column (column K), matched by serial number. Never changes serials, statuses or locations, and
          never asks to clear anything. Sends the result to the server so every device gets it.
        </p>
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={wattsBusy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onWattsFile(f);
            e.target.value = '';
          }}
          className="text-sm text-slate-300"
        />
        {wattsProgress && <p className="mt-2 text-xs text-accent-amber">{wattsProgress}...</p>}
        {wattsError && <p className="mt-2 text-xs text-status-pending">{wattsError}</p>}
        {wattsResult && (
          <div className="mt-3 text-xs text-slate-300">
            <div className="text-status-replaced">✓ {wattsResult.panelsUpdated.toLocaleString()} panels updated</div>
            <div>{wattsResult.panelsUnchanged.toLocaleString()} already had the right value · {wattsResult.panelsNotInExcel.toLocaleString()} not in the Excel</div>
            {wattsResult.pushFailed ? (
              <div className="mt-1 text-status-observation">
                Saved on this device, but sending to the server stopped part-way ({wattsResult.pushed.toLocaleString()} sent). Run it again once online to finish.
              </div>
            ) : (
              <div className="mt-1 text-slate-500">{wattsResult.pushed.toLocaleString()} panels sent to the server. Other devices pick this up on their next sync (one-time full re-download each).</div>
            )}
          </div>
        )}
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
              <button onClick={handlePush} className="rounded-lg btn-primary px-4 py-2 text-sm font-semibold text-white">
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
            {histResult.pushFailed ? (
              <div className="rounded-lg border border-status-pending bg-status-pending/10 p-2 text-status-pending">
                ⚠ Saved on this device, but couldn't reach the shared server just now (no connection?) -- other
                devices won't see this until it syncs. It'll retry automatically, or tap "Sync now" on the Sync page.
              </div>
            ) : (
              <div className="text-status-replaced">✓ Uploaded to the shared server -- other devices will see this on their next sync.</div>
            )}
            <div className="text-status-replaced">✓ {histResult.matched} panel(s) updated.</div>
            {histResult.vacated > 0 && (
              <div className="text-status-pending">
                ⚠ {histResult.vacated} row(s) had a non-serial "after" value (e.g. "To be installed") -- those panels
                were marked vacant instead of getting a fake serial.
              </div>
            )}
            {histResult.relocatedFrom > 0 && (
              <div className="text-status-pending">
                ⚠ {histResult.relocatedFrom} panel(s) were found already installed elsewhere -- their ORIGINAL
                location was marked vacant, since the panel physically moved away from there.
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
          <label className="inline-block cursor-pointer rounded-lg btn-primary px-4 py-2 text-sm font-semibold text-white">
            Choose Excel file
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleHistoricalPreview(e.target.files[0])}
            />
          </label>
        )}

        {histPreviewRows && !histBusy && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border p-3 text-xs">
            <div className="font-semibold text-slate-300">
              Preview -- first {histPreviewRows.length} row(s) as read from your file, checked against current data:
            </div>
            <div className="max-h-60 overflow-y-auto">
              {histPreviewRows.map((r, i) => (
                <div key={i} className="border-t border-border py-1 font-mono">
                  <div>
                    before: {r.before} → after: {r.after}
                  </div>
                  <div className={histPreviewChecks?.[i]?.includes('before ✓') ? 'text-status-replaced' : 'text-status-pending'}>
                    {histPreviewChecks?.[i] ?? 'checking...'}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-slate-500">
              Do those "before" values match what you see in the Excel exactly, digit for digit? If not, that's
              the mismatch -- tell me what's different and we'll fix the reading instead of guessing again.
            </p>
            <button
              onClick={() => histFile && handleHistoricalFile(histFile)}
              className="self-start rounded-lg btn-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Looks right -- run the full update
            </button>
          </div>
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
          <Link to="/import-history" className="ml-2 inline-block rounded-lg border border-border px-4 py-2 text-sm font-semibold text-slate-300">
            View import &amp; restore history
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
