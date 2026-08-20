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
          const row = payload.new as SupaPanelRow;
          if (!row?.panel_id) return;
          db.panels.put(fromRealtimeRow(row)).catch((err) => {
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
