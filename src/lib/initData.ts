import { db } from './db';
import { hasSupabase } from './supabase';
import { pullLocationsAndPanels, type SyncProgress } from './sync';
import { seedFictionalDataIfEmpty } from './fictionalData';

/**
 * Runs once when the app starts. If this device already has any panels locally (real or
 * fictional), leaves it alone -- this is only for a brand new/empty device. Order of
 * preference: pull the real data from Supabase if it's configured and reachable; only fall
 * back to the fictional Etapa 0 seed if that's not possible.
 */
export async function initializeData(onStatus?: (text: string) => void): Promise<void> {
  const existing = await db.panels.count();
  if (existing > 0) return;

  if (hasSupabase()) {
    try {
      onStatus?.('Connecting to server...');
      const result = await pullLocationsAndPanels((p: SyncProgress) => {
        const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
        onStatus?.(`${p.phase}... ${pct}%`);
      });
      if (result.panels > 0) return; // got real data, done
    } catch (err) {
      console.error('Initial Supabase pull failed, falling back to fictional seed:', err);
    }
  }

  onStatus?.('Loading test data...');
  await seedFictionalDataIfEmpty();
}
