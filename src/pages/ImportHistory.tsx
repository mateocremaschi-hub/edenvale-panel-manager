import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

/**
 * A plain, chronological log of every bulk/admin action logged via logImportEvent -- the
 * normal Import wizard and the "Restore panel data from master Excel" tool both write here.
 * Exists specifically so "did anyone run X recently?" has a real answer instead of relying on
 * everyone's memory (or lack of it) -- came out of a real incident where every 'vacant' panel
 * mark had disappeared and nobody could say for certain whether Restore had been re-run.
 */
export default function ImportHistory() {
  const events = useLiveQuery(
    () => db.activityEvents.where('entityId').equals('bulk-import').reverse().sortBy('timestamp'),
    [],
    []
  );
  const operators = useLiveQuery(() => db.operators.toArray(), [], []);
  const nameFor = (id: string) => operators?.find((o) => o.operatorId === id)?.name ?? id;

  return (
    <div>
      <h1 className="mb-2 font-display text-xl font-bold tracking-tight text-slate-50">Import &amp; restore history</h1>
      <p className="mb-4 text-sm text-slate-400">
        Every time someone runs "Import Excel" or "Restore panel data from master Excel", it's logged here --
        who, when, and a short summary of what happened.
      </p>

      {events && events.length === 0 && <p className="text-sm text-slate-500">No bulk imports or restores logged yet.</p>}

      <div className="flex flex-col gap-2">
        {events?.map((e) => {
          const isRestore = e.newValue?.startsWith('Restore from master Excel');
          return (
            <div
              key={e.eventId}
              className={`rounded-lg border p-3 text-sm ${isRestore ? 'border-status-pending/50 bg-status-pending/5' : 'border-border bg-bg-panel'}`}
            >
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{nameFor(e.operator)}</span>
                <span>{new Date(e.timestamp).toLocaleString()}</span>
              </div>
              <div className={`mt-1 ${isRestore ? 'font-semibold text-status-pending' : 'text-slate-200'}`}>
                {isRestore && '⚠ '}
                {e.newValue}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
