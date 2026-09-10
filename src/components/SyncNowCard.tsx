import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { hasSupabase } from '@/lib/supabase';
import { syncOperationalRecords } from '@/lib/outboxSync';

/** The one sync action a technician actually needs, right on the Dashboard: send whatever this
 * device recorded in the field and pull in whatever others did since. The full "Re-download
 * everything" recovery tool stays on the Sync page -- this is the everyday button. Shows how
 * many of THIS device's own records are still waiting to go out, so "did my reports make it to
 * the computer?" has a visible answer instead of a guess. */
export default function SyncNowCard() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

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

  if (!hasSupabase()) return null;

  async function syncNow() {
    setError(null);
    setSyncing(true);
    try {
      const r = await syncOperationalRecords(setStatus);
      setStatus(
        `Up to date (${new Date().toLocaleTimeString()}). Sent ${r.pushedIssues + r.pushedReplacements} of yours, received ${
          r.pulledIssues + r.pulledReplacements
        } from others, ${r.pulledPanels} panel(s) updated.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="card-premium mb-5 flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold text-slate-100">
          {pending > 0 ? `${pending} record${pending === 1 ? '' : 's'} on this device not sent yet` : 'Everything on this device is sent'}
        </div>
        <div className="text-xs text-slate-400">
          {error ? <span className="text-status-pending">{error}</span> : status ?? 'Syncs automatically every few minutes -- tap to do it right now.'}
        </div>
      </div>
      <button
        onClick={syncNow}
        disabled={syncing}
        className="rounded-xl btn-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {syncing ? 'Syncing...' : '🔄 Sync now'}
      </button>
    </div>
  );
}
