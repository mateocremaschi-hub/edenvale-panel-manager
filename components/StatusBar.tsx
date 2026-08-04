import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

export default function StatusBar() {
  const [online, setOnline] = useState(navigator.onLine);
  const hasBackend = Boolean(import.meta.env.VITE_SUPABASE_URL);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const pending = useLiveQuery(
    () =>
      Promise.all([
        db.issues.where('syncStatus').equals('pending').count(),
        db.replacements.where('syncStatus').equals('pending').count(),
        db.activityEvents.where('syncStatus').equals('pending').count(),
      ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
    [],
    0
  );

  return (
    <div className="flex items-center justify-between border-b border-border bg-bg-panel px-4 py-2 text-xs text-slate-400">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${online ? 'bg-status-replaced' : 'bg-status-pending'}`} />
        {online ? 'Online' : 'Offline'}
      </span>
      <span>
        {hasBackend ? (pending > 0 ? `${pending} pending sync` : 'All synced') : 'Local only (no backend yet)'}
      </span>
    </div>
  );
}
