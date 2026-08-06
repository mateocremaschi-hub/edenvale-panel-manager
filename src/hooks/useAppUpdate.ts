import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

const CHECK_INTERVAL_MS = 60 * 1000; // vite-plugin-pwa only checks on navigation by default --
// this polls every minute so an app left open for a while still notices a new build.

/** Registers the service worker, checks for a new version periodically, and gives back a
 * flag + a function to actually apply the update (reloads the page on the new version). */
export function useAppUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateFnRef = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    updateFnRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegistered(registration) {
        if (!registration) return;
        window.setInterval(() => {
          registration.update().catch(() => {});
        }, CHECK_INTERVAL_MS);
      },
    });
  }, []);

  return {
    needRefresh,
    applyUpdate: () => updateFnRef.current?.(true),
  };
}
