import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

export default function Sync() {
  const hasBackend = Boolean(import.meta.env.VITE_SUPABASE_URL);
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

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-100">Sync</h1>
      <div className="rounded-xl border border-border bg-bg-panel p-4 text-sm text-slate-300">
        {hasBackend ? (
          <p>Supabase URL detected. Pull/push sync (paginated, upsert, conflict handling) ships in Etapa 7.</p>
        ) : (
          <>
            <p className="mb-2">
              No backend connected yet — everything below lives only in this device's IndexedDB.
            </p>
            <p className="text-slate-500">
              Once the Supabase project for Panel Manager exists, add its URL and anon key to the app's
              environment variables and this page will start showing real sync status (pending changes,
              last sync, conflicts), following the same pattern already proven in Vegetation Control.
            </p>
          </>
        )}
      </div>
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
