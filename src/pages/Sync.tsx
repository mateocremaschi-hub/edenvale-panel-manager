import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { hasSupabase } from '@/lib/supabase';
import { pullLocationsAndPanels, type SyncProgress } from '@/lib/sync';
import { syncOperationalRecords } from '@/lib/outboxSync';

export default function Sync() {
  const configured = hasSupabase();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [fullProgress, setFullProgress] = useState<SyncProgress | null>(null);
  const [fullSyncing, setFullSyncing] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);
  const [fullDone, setFullDone] = useState(false);

  const counts = useLiveQuery(
    async () => ({
      panels: await db.panels.count(),
      issues: await db.issues.count(),
      replacements: await db.replacements.count(),
      events: await db.activityEvents.count(),
    }),
    [],
    { panels: 0, issues: 0, replacements: 0, events: 0 }
  );

  const pending = useLiveQuery(
    () =>
      Promise.all([
        db.issues.where('syncStatus').equals('pending').count(),
        db.replacements.where('syncStatus').equals('pending').count(),
        db.activityEvents.where('syncStatus').equals('pending').count(),
        db.photos.where('syncStatus').equals('pending').count(),
      ]).then((c) => c.reduce((a, b) => a + b, 0)),
    [],
    0
  );

  async function syncNow() {
    setError(null);
    setSyncing(true);
    try {
      const result = await syncOperationalRecords(setStatus);
      setLastSync(new Date().toLocaleTimeString());
      setStatus(
        `Done: sent ${result.pushedIssues + result.pushedReplacements} of yours, received ${
          result.pulledIssues + result.pulledReplacements
        } from others.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  async function fullResync() {
    setFullError(null);
    setFullDone(false);
    setFullSyncing(true);
    try {
      await pullLocationsAndPanels(setFullProgress);
      setFullDone(true);
    } catch (err) {
      setFullError(err instanceof Error ? err.message : String(err));
    } finally {
      setFullSyncing(false);
      setFullProgress(null);
    }
  }

  return (
    <div>
      <h1 className="mb-4 font-display text-xl font-bold tracking-tight text-slate-50">Sync</h1>
      <div className="rounded-xl border border-border bg-bg-panel p-4 text-sm text-slate-300">
        {configured ? (
          <p>
            Connected to the shared server. Reports, replacements, and photos you create here sync with
            every other device -- automatically when you're online, or tap "Sync now" any time.
          </p>
        ) : (
          <>
            <p className="mb-2">No backend connected yet -- everything below lives only in this device's IndexedDB.</p>
            <p className="text-slate-500">
              Once the Supabase project is configured (ask whoever set up the app), this page will sync
              with every other device automatically.
            </p>
          </>
        )}
      </div>

      {configured && (
        <div className="mt-4 rounded-xl border border-border bg-bg-panel p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Locations & panels</h2>
          <p className="mb-3 text-xs text-slate-500">
            If this device is missing blocks or panels (e.g. the first download got interrupted), use this
            to re-download everything from the server.
          </p>
          {fullError && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{fullError}</div>}
          {fullDone && <div className="mb-3 rounded-lg bg-status-replaced/20 p-2 text-xs text-status-replaced">Re-sync complete.</div>}
          {fullProgress ? (
            <div>
              <p className="mb-1 text-xs text-slate-400">
                {fullProgress.phase}... {fullProgress.done.toLocaleString()} / {fullProgress.total.toLocaleString()}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full bg-accent-blue transition-all"
                  style={{ width: `${fullProgress.total ? (fullProgress.done / fullProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={fullResync}
              disabled={fullSyncing}
              className="rounded-lg border border-accent-blue px-4 py-2 text-sm font-semibold text-accent-blue disabled:opacity-40"
            >
              Re-download all locations & panels
            </button>
          )}
        </div>
      )}

      {configured && (
        <div className="mt-4 rounded-xl border border-border bg-bg-panel p-4">
          {error && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{error}</div>}
          {syncing ? (
            <p className="text-xs text-slate-400">{status}</p>
          ) : (
            <div className="flex items-center justify-between">
              <button onClick={syncNow} className="rounded-lg btn-primary px-4 py-2 text-sm font-semibold text-white">
                Sync now
              </button>
              <div className="text-right text-xs text-slate-500">
                {pending > 0 && <div>{pending} waiting to upload</div>}
                {lastSync && <div>Last synced {lastSync}</div>}
                {!syncing && status && <div className="mt-1 text-slate-400">{status}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(counts ?? {}).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-bg-panel p-4">
            <div className="text-xl font-bold text-slate-100">{v}</div>
            <div className="text-xs capitalize text-slate-400">{k} stored locally</div>
          </div>
        ))}
      </div>
    </div>
  );
}
