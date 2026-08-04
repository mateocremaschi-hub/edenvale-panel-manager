import { getSupabase } from './supabase';
import { db, setDataSource } from './db';
import type { PhysicalLocation, Panel, PanelStatus } from './types';

const BATCH = 1000;

function toSupaLocation(l: PhysicalLocation) {
  return {
    location_id: l.locationId,
    block: l.block,
    tracker: l.tracker ?? null,
    row_label: l.row ?? null,
    dc_box: l.dcBox,
    array_bus: l.arrayBus,
    string_code: l.stringCode,
    position_in_string: l.positionInString,
    orientation: l.orientation,
  };
}

function fromSupaLocation(r: any): PhysicalLocation {
  return {
    locationId: r.location_id,
    block: r.block,
    tracker: r.tracker ?? undefined,
    row: r.row_label ?? undefined,
    dcBox: r.dc_box,
    arrayBus: r.array_bus,
    stringCode: r.string_code,
    positionInString: r.position_in_string,
    orientation: r.orientation,
  };
}

function toSupaPanel(p: Panel) {
  return {
    panel_id: p.panelId,
    serial_number: p.serialNumber,
    serial_number_short: p.serialNumberShort ?? null,
    voltage: p.voltage ?? null,
    location_id: p.locationId,
    status: p.status,
    install_date: p.installDate ?? null,
    sun_manager_id: p.sunManagerId ?? null,
  };
}

function fromSupaPanel(r: any): Panel {
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

export interface SyncProgress {
  phase: string;
  done: number;
  total: number;
}

/** One-time (repeatable/safe) upload of every local location + panel to Supabase. Meant to
 * run from the device that holds the real imported data -- other devices then just pull. */
export async function pushLocationsAndPanels(onProgress?: (p: SyncProgress) => void): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');

  const locations = await db.locations.toArray();
  const panels = await db.panels.toArray();
  const total = locations.length + panels.length;
  let done = 0;

  for (let i = 0; i < locations.length; i += BATCH) {
    const batch = locations.slice(i, i + BATCH).map(toSupaLocation);
    const { error } = await supabase.from('locations').upsert(batch, { onConflict: 'location_id' });
    if (error) throw new Error(`Pushing locations failed: ${error.message}`);
    done += batch.length;
    onProgress?.({ phase: 'Uploading locations', done, total });
  }

  for (let i = 0; i < panels.length; i += BATCH) {
    const batch = panels.slice(i, i + BATCH).map(toSupaPanel);
    const { error } = await supabase.from('panels').upsert(batch, { onConflict: 'panel_id' });
    if (error) throw new Error(`Pushing panels failed: ${error.message}`);
    done += batch.length;
    onProgress?.({ phase: 'Uploading panels', done, total });
  }
}

/** Downloads every location + panel from Supabase into this device's local cache (Dexie),
 * paginated so it doesn't try to hold one giant response in memory. Used automatically on
 * first launch of a new device, and available as a manual "Sync now" too. */
export async function pullLocationsAndPanels(onProgress?: (p: SyncProgress) => void): Promise<{ locations: number; panels: number }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');

  const { count: locCount } = await supabase.from('locations').select('*', { count: 'exact', head: true });
  const { count: panelCount } = await supabase.from('panels').select('*', { count: 'exact', head: true });
  const total = (locCount ?? 0) + (panelCount ?? 0);
  let done = 0;

  let locTotal = 0;
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await supabase.from('locations').select('*').range(from, from + BATCH - 1);
    if (error) throw new Error(`Pulling locations failed: ${error.message}`);
    if (!data || data.length === 0) break;
    await db.locations.bulkPut(data.map(fromSupaLocation));
    locTotal += data.length;
    done += data.length;
    onProgress?.({ phase: 'Downloading locations', done, total });
    if (data.length < BATCH) break;
  }

  let panelTotal = 0;
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await supabase.from('panels').select('*').range(from, from + BATCH - 1);
    if (error) throw new Error(`Pulling panels failed: ${error.message}`);
    if (!data || data.length === 0) break;
    await db.panels.bulkPut(data.map(fromSupaPanel));
    panelTotal += data.length;
    done += data.length;
    onProgress?.({ phase: 'Downloading panels', done, total });
    if (data.length < BATCH) break;
  }

  if (panelTotal > 0) await setDataSource('real');
  return { locations: locTotal, panels: panelTotal };
}
