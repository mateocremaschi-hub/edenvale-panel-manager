import { useEffect, useRef } from 'react';
import { hasSupabase } from '@/lib/supabase';
import { syncOperationalRecords } from '@/lib/outboxSync';

const PERIODIC_MS = 3 * 60 * 1000; // every 3 minutes while the app is open and online

/** Fires a background sync when connectivity comes back, and periodically while online.
 * Silent by design (errors are logged, not shown) -- "Sync now" on the Sync page is there
 * for when someone wants to see what's happening or force it. */
export function useAutoSync() {
  const runningRef = useRef(false);

  useEffect(() => {
    if (!hasSupabase()) return;

    async function run() {
      if (runningRef.current || !navigator.onLine) return;
      runningRef.current = true;
      try {
        await syncOperationalRecords();
      } catch (err) {
        console.error('Background sync failed:', err);
      } finally {
        runningRef.current = false;
      }
    }

    run(); // once on mount, in case there's anything pending from a previous offline session
    window.addEventListener('online', run);
    const interval = window.setInterval(run, PERIODIC_MS);

    return () => {
      window.removeEventListener('online', run);
      window.clearInterval(interval);
    };
  }, []);
}
