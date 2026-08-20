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
 * normally once back online. Mount once, near the app root -- see App.tsx. */
export function usePanelsRealtime() {
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

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
          db.panels.put(fromRealtimeRow(payload.new)).catch((err) => {
            console.error('Applying live panel update failed:', err);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}
