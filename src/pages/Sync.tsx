import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { hasSupabase } from '@/lib/supabase';
import { pullLocationsAndPanels, type SyncProgress } from '@/lib/sync';

export default function Sync() {
  const configured = hasSupabase();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

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

  async function syncNow() {
    setError(null);
    try {
      await pullLocationsAndPanels(setProgress);
      setLastSync(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-100">Sync</h1>
      <div className="rounded-xl border border-border bg-bg-panel p-4 text-sm text-slate-300">
        {configured ? (
          <>
            <p className="mb-2">Connected to the shared server. Locations and panels sync on request.</p>
            <p className="text-slate-500">
              Reports and replacements you create here are still local-only to this device for now --
              that part of the sync is coming next.
            </p>
          </>
        ) : (
          <>
            <p className="mb-2">No backend connected yet -- everything below lives only in this device's IndexedDB.</p>
            <p className="text-slate-500">
              Once the Supabase project is configured (ask whoever set up the app), this page will pull
              the shared real data automatically.
            </p>
          </>
        )}
      </div>

      {configured && (
        <div className="mt-4 rounded-xl border border-border bg-bg-panel p-4">
          {error && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{error}</div>}
          {progress ? (
            <div>
              <p className="mb-1 text-xs text-slate-400">
                {progress.phase}... {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full bg-accent-blue transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button onClick={syncNow} className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
                Sync now
              </button>
              {lastSync && <span className="text-xs text-slate-500">Last synced {lastSync}</span>}
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
