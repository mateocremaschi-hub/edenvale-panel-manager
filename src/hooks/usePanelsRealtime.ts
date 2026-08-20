import { useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import { db } from '@/lib/db';
import type { Panel, PanelStatus } from '@/lib/types';

interface SupaPanelRow {
  panel_id: string;
  serial_number: string;
  serial_number_short: string | null;
  voltage: number | null;
  location_id: string;
  status: string;
  install_date: string | null;
  sun_manager_id: string | null;
}

function fromRealtimeRow(r: SupaPanelRow): Panel {
  return {
    panelId: r.panel_id,
    serialNumber: r.serial_number,
    serialNumberShort: r.serial_number_short ?? undefined,
    voltage: r.voltage ?? undefined,
    locationId: r.location_id,
    status: r.status as PanelStatus,
    installDate: r.install_date ?? undefined,
    sunManagerId: r.sun_manager_id ?? undefined,
  };
}

const VALID_STATUSES = new Set([
  'normal',
  'issue_reported',
  'under_assessment',
  'monitoring',
  'pending_replacement',
  'replaced',
  'vacant',
  'closed',
]);

/** Defensive check before applying a realtime payload -- a partial/malformed row (missing or
 * unrecognized fields, which shouldn't normally happen but would be silently destructive if it
 * did: a panel could lose its real status/serial and quietly stop showing as vacant/pending)
 * must never be written to local data. Better to skip a live update (the regular pull-based
 * sync will still catch the real state) than risk corrupting what's already there. */
function isCompletePanelRow(r: unknown): r is SupaPanelRow {
  if (!r || typeof r !== 'object') return false;
  const row = r as Record<string, unknown>;
  return (
    typeof row.panel_id === 'string' &&
    row.panel_id.length > 0 &&
    typeof row.serial_number === 'string' &&
    typeof row.location_id === 'string' &&
    row.location_id.length > 0 &&
    typeof row.status === 'string' &&
    VALID_STATUSES.has(row.status)
  );
}

/** Subscribes to live panel changes on Supabase (Realtime) so every device reflects a change
 * -- a field correction, an historical Excel import, another admin's push -- the moment it
 * happens, without waiting for the periodic sync or a manual "Sync now"/"Re-download". This is
 * purely additive: the existing pull-based sync (useAutoSync) still runs as-is, so anything
 * missed while offline (Realtime only works with an active connection) still gets caught up
 * normally once back online. Mount once, near the app root -- see App.tsx.
 *
 * Batches incoming changes instead of applying each one immediately: a single bulk operation
 * (a full "Push local data to Supabase", or a large historical Excel import) can generate
 * hundreds of thousands of individual change events in a short burst. Applying each with its
 * own db.panels.put() -- and letting every useLiveQuery-based screen (the Map, in particular,
 * which iterates all 36 blocks) re-render on every single one -- froze the app in practice
 * during exactly this kind of burst. Instead, incoming rows are buffered (de-duplicated by
 * panelId, keeping only the latest version of each) and flushed together via one bulkPut()
 * every 500ms -- still feels instant for the normal case (a single report or replacement), but
 * collapses a flood of thousands of events into a handful of writes and re-renders. */
export function usePanelsRealtime() {
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    let buffer = new Map<string, Panel>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushing = false;

    async function flush() {
      flushTimer = null;
      if (buffer.size === 0) return;
      const toApply = Array.from(buffer.values());
      buffer = new Map();
      flushing = true;
      try {
        await db.panels.bulkPut(toApply);
      } catch (err) {
        console.error('Applying live panel updates failed:', err);
      } finally {
        flushing = false;
        // More arrived while this flush was writing -- schedule another round rather than
        // dropping them.
        if (buffer.size > 0 && flushTimer == null) flushTimer = setTimeout(flush, 500);
      }
    }

    function scheduleFlush() {
      if (flushTimer != null || flushing) return;
      flushTimer = setTimeout(flush, 500);
    }

    const channel = supabase
      .channel('panels-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'panels' },
        (payload) => {
          if (payload.eventType === 'DELETE') return; // panels are never deleted, only updated
          if (!isCompletePanelRow(payload.new)) {
            console.error('Skipped an incomplete/malformed realtime panel payload:', payload.new);
            return;
          }
          const panel = fromRealtimeRow(payload.new);
          buffer.set(panel.panelId, panel); // de-dupe: only the latest version per panel survives
          scheduleFlush();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (flushTimer != null) clearTimeout(flushTimer);
    };
  }, []);
}
