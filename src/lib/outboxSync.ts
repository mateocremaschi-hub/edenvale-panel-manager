import { getSupabase } from './supabase';
import { db } from './db';
import { newId } from './id';
import { nowIso } from './time';
import { pushPanelsById, pullPanelsById, pullPanelsUpdatedSince } from './sync';
import { pullTrackerPicas } from './dronePicas';
import { pullAdminPinHash } from './adminPinSync';
import { useSettings } from '@/store/settings';
import type { Issue, Replacement, ActivityEvent, Photo } from './types';

// ---- local -> Supabase row mappers ----

function issueToRow(i: Issue) {
  return {
    issue_id: i.issueId,
    location_id: i.locationId,
    panel_id_at_report: i.panelIdAtReport,
    type: i.type,
    severity: i.severity,
    description: i.description,
    status: i.status,
    reported_by: i.reportedBy,
    reported_date: i.reportedDate,
    sun_manager_id: i.sunManagerId ?? null,
    requires_replacement: i.requiresReplacement,
    monitor_only: i.monitorOnly,
    immediate_safety_concern: i.immediateSafetyConcern,
    recommended_action: i.recommendedAction ?? null,
    photo_ids: i.photoIds,
    notes: i.notes ?? null,
  };
}

function rowToIssue(r: any): Issue {
  return {
    issueId: r.issue_id,
    locationId: r.location_id,
    panelIdAtReport: r.panel_id_at_report,
    type: r.type,
    severity: r.severity,
    description: r.description ?? '',
    status: r.status,
    reportedBy: r.reported_by,
    reportedDate: r.reported_date,
    sunManagerId: r.sun_manager_id ?? undefined,
    requiresReplacement: r.requires_replacement,
    monitorOnly: r.monitor_only,
    immediateSafetyConcern: r.immediate_safety_concern,
    recommendedAction: r.recommended_action ?? undefined,
    photoIds: r.photo_ids ?? [],
    notes: r.notes ?? undefined,
    syncStatus: 'synced',
  };
}

function replacementToRow(r: Replacement) {
  return {
    replacement_id: r.replacementId,
    location_id: r.locationId,
    removed_panel_id: r.removedPanelId,
    removed_serial: r.removedSerial,
    installed_panel_id: r.installedPanelId,
    installed_serial: r.installedSerial,
    old_voltage: r.oldVoltage ?? null,
    new_voltage: r.newVoltage ?? null,
    replacement_date: r.replacementDate,
    replaced_by: r.replacedBy,
    replaced_by_name: r.replacedByName,
    sun_manager_id: r.sunManagerId ?? null,
    sm_uploaded: r.smUploaded ?? false,
    reason: r.reason ?? null,
    related_issue_id: r.relatedIssueId ?? null,
    removed_panel_destination: r.removedPanelDestination ?? null,
    photo_ids: r.photoIds,
    notes: r.notes ?? null,
  };
}

function rowToReplacement(r: any): Replacement {
  return {
    replacementId: r.replacement_id,
    locationId: r.location_id,
    removedPanelId: r.removed_panel_id,
    removedSerial: r.removed_serial,
    installedPanelId: r.installed_panel_id,
    installedSerial: r.installed_serial,
    oldVoltage: r.old_voltage ?? undefined,
    newVoltage: r.new_voltage ?? undefined,
    replacementDate: r.replacement_date,
    replacedBy: r.replaced_by,
    replacedByName: r.replaced_by_name ?? r.replaced_by,
    sunManagerId: r.sun_manager_id ?? undefined,
    smUploaded: r.sm_uploaded ?? false,
    reason: r.reason ?? '',
    relatedIssueId: r.related_issue_id ?? undefined,
    removedPanelDestination: r.removed_panel_destination ?? undefined,
    photoIds: r.photo_ids ?? [],
    notes: r.notes ?? undefined,
    syncStatus: 'synced',
  };
}

function eventToRow(e: ActivityEvent) {
  return {
    event_id: e.eventId,
    entity_type: e.entityType,
    entity_id: e.entityId,
    action: e.action,
    previous_value: e.previousValue ?? null,
    new_value: e.newValue ?? null,
    operator: e.operator,
    event_timestamp: e.timestamp,
    correction_of: e.correctionOf ?? null,
    correction_reason: e.correctionReason ?? null,
  };
}

function rowToEvent(r: any): ActivityEvent {
  return {
    eventId: r.event_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    previousValue: r.previous_value ?? undefined,
    newValue: r.new_value ?? undefined,
    operator: r.operator,
    timestamp: r.event_timestamp,
    syncStatus: 'synced',
    correctionOf: r.correction_of ?? undefined,
    correctionReason: r.correction_reason ?? undefined,
  };
}

function photoStoragePath(p: Photo): string {
  return `${p.relatedType}/${p.relatedId}/${p.photoId}.jpg`;
}

function photoToRow(p: Photo) {
  return {
    photo_id: p.photoId,
    related_type: p.relatedType,
    related_id: p.relatedId,
    storage_path: photoStoragePath(p),
    taken_at: p.takenAt,
    author: p.author,
    description: p.description ?? null,
    photo_role: p.photoRole ?? null,
  };
}

/** After a full-table pull, removes local 'synced' records whose id is no longer present on the
 * server -- a plain pull only ever adds/updates, so a server-side delete (e.g. the historical-
 * import cleanup tool) would otherwise leave stale copies sitting in local devices forever.
 * Never touches 'pending' records (not yet pushed) or 'local' ones (fictional/seed data, never
 * meant to sync) -- only things this device already believes are in sync with the server. */
async function deleteLocallyIfGoneRemotely<T extends Record<string, unknown>>(
  table: { where(index: string): { equals(v: string): { toArray(): Promise<T[]> } }; bulkDelete(keys: string[]): Promise<void> },
  idField: string,
  remoteIds: string[]
): Promise<void> {
  const remoteSet = new Set(remoteIds);
  const localSynced = await table.where('syncStatus').equals('synced').toArray();
  const staleKeys = localSynced.filter((r) => !remoteSet.has(r[idField] as string)).map((r) => r[idField] as string);
  if (staleKeys.length > 0) await table.bulkDelete(staleKeys);
}

export interface OutboxSummary {
  pushedIssues: number;
  pushedReplacements: number;
  pushedEvents: number;
  pushedPhotos: number;
  pulledIssues: number;
  pulledReplacements: number;
  pulledEvents: number;
  pulledPhotos: number;
  pulledPanels: number;
}

/** Uploads every locally-pending issue/replacement/activity-event/photo to Supabase, then
 * marks them synced. Safe to call repeatedly (idempotent upserts, same ids as local). */
export async function pushOutbox(onStatus?: (text: string) => void): Promise<{ issues: number; replacements: number; events: number; photos: number }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');

  const pendingIssues = await db.issues.where('syncStatus').equals('pending').toArray();
  if (pendingIssues.length > 0) {
    onStatus?.(`Uploading ${pendingIssues.length} report(s)...`);
    const { error } = await supabase.from('issues').upsert(pendingIssues.map(issueToRow), { onConflict: 'issue_id' });
    if (error) throw new Error(`Uploading reports failed: ${error.message}`);
    await db.issues.bulkPut(pendingIssues.map((i) => ({ ...i, syncStatus: 'synced' as const })));
    await pushPanelsById([...new Set<string>(pendingIssues.map((i) => i.panelIdAtReport))]);
  }

  const pendingReplacements = await db.replacements.where('syncStatus').equals('pending').toArray();
  if (pendingReplacements.length > 0) {
    onStatus?.(`Uploading ${pendingReplacements.length} replacement(s)...`);
    const { error } = await supabase.from('replacements').upsert(pendingReplacements.map(replacementToRow), { onConflict: 'replacement_id' });
    if (error) throw new Error(`Uploading replacements failed: ${error.message}`);
    await db.replacements.bulkPut(pendingReplacements.map((r) => ({ ...r, syncStatus: 'synced' as const })));
    await pushPanelsById([...new Set<string>(pendingReplacements.map((r) => r.installedPanelId))]);
  }

  const pendingPhotos = await db.photos.where('syncStatus').equals('pending').toArray();
  let pushedPhotos = 0;
  if (pendingPhotos.length > 0) {
    onStatus?.(`Uploading ${pendingPhotos.length} photo(s)...`);
    for (const p of pendingPhotos) {
      const path = photoStoragePath(p);
      const { error: upErr } = await supabase.storage.from('photos').upload(path, p.blob, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw new Error(`Uploading photo failed: ${upErr.message}`);
      const { error: rowErr } = await supabase.from('photos').upsert([photoToRow(p)], { onConflict: 'photo_id' });
      if (rowErr) throw new Error(`Saving photo record failed: ${rowErr.message}`);
      await db.photos.update(p.photoId, { syncStatus: 'synced' });
      pushedPhotos++;
    }
  }

  // Activity events are append-only -- push whatever hasn't been marked synced yet.
  const pendingEvents = await db.activityEvents.where('syncStatus').equals('pending').toArray();
  if (pendingEvents.length > 0) {
    onStatus?.(`Uploading ${pendingEvents.length} activity event(s)...`);
    const { error } = await supabase.from('activity_events').upsert(pendingEvents.map(eventToRow), { onConflict: 'event_id' });
    if (error) throw new Error(`Uploading activity events failed: ${error.message}`);
    await db.activityEvents.bulkPut(pendingEvents.map((e) => ({ ...e, syncStatus: 'synced' as const })));
  }

  return {
    issues: pendingIssues.length,
    replacements: pendingReplacements.length,
    events: pendingEvents.length,
    photos: pushedPhotos,
  };
}

/** Downloads every issue/replacement/activity-event/photo from Supabase into this device's
 * local cache. These tables stay small (hundreds-thousands of rows even after years of
 * use), so a full pull each time is simpler and cheap enough -- no incremental logic needed. */
/** Supabase caps an unpaginated select('*') at 1000 rows by default -- these tables all grow
 * over time (every report, replacement, activity event, and photo ever logged), so a single
 * unpaginated call would silently start truncating once any of them crossed that line. Pages
 * through in batches of 1000 until a batch comes back short, same pattern already used for
 * pullLocationsAndPanels (the panels table) and pullTrackerPicas. */
async function fetchAllRows(supabase: NonNullable<ReturnType<typeof getSupabase>>, table: string): Promise<Record<string, unknown>[]> {
  const BATCH = 1000;
  let from = 0;
  const all: Record<string, unknown>[] = [];
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + BATCH - 1);
    if (error) throw new Error(`Downloading ${table} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return all;
}

export async function pullOperationalRecords(onStatus?: (text: string) => void): Promise<{ issues: number; replacements: number; events: number; photos: number }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured.');

  onStatus?.('Downloading reports...');
  const issueRows = (await fetchAllRows(supabase, 'issues')) as any[];
  if (issueRows.length > 0) await db.issues.bulkPut(issueRows.map(rowToIssue));
  await deleteLocallyIfGoneRemotely(db.issues, 'issueId', issueRows.map((r) => r.issue_id));

  onStatus?.('Downloading replacements...');
  const replRows = (await fetchAllRows(supabase, 'replacements')) as any[];
  if (replRows.length > 0) await db.replacements.bulkPut(replRows.map(rowToReplacement));
  await deleteLocallyIfGoneRemotely(db.replacements, 'replacementId', replRows.map((r) => r.replacement_id));

  const touchedPanelIds = [...new Set<string>([...issueRows.map((r) => r.panel_id_at_report), ...replRows.map((r) => r.installed_panel_id)])];
  if (touchedPanelIds.length > 0) {
    onStatus?.('Syncing panel status...');
    await pullPanelsById(touchedPanelIds);
  }

  onStatus?.('Downloading activity history...');
  const eventRows = (await fetchAllRows(supabase, 'activity_events')) as any[];
  if (eventRows.length > 0) await db.activityEvents.bulkPut(eventRows.map(rowToEvent));
  await deleteLocallyIfGoneRemotely(db.activityEvents, 'eventId', eventRows.map((r) => r.event_id));

  onStatus?.('Downloading photos...');
  const photoRows = (await fetchAllRows(supabase, 'photos')) as any[];
  await deleteLocallyIfGoneRemotely(db.photos, 'photoId', photoRows.map((r) => r.photo_id));
  let pulledPhotos = 0;
  for (const row of photoRows) {
    const existing = await db.photos.get(row.photo_id);
    if (existing) continue; // already have the blob locally, don't re-download
    const { data: blob, error: dlErr } = await supabase.storage.from('photos').download(row.storage_path);
    if (dlErr || !blob) continue; // skip a single bad photo rather than fail the whole sync
    await db.photos.put({
      photoId: row.photo_id,
      relatedType: row.related_type,
      relatedId: row.related_id,
      blob,
      takenAt: row.taken_at,
      author: row.author,
      description: row.description ?? undefined,
      photoRole: row.photo_role ?? undefined,
      syncStatus: 'synced',
    });
    pulledPhotos++;
  }

  return {
    issues: issueRows.length,
    replacements: replRows.length,
    events: eventRows.length,
    photos: pulledPhotos,
  };
}

/** Push local changes first, then pull -- so this device's own new records aren't
 * immediately (and pointlessly) re-downloaded as if they were someone else's. */
export async function syncOperationalRecords(onStatus?: (text: string) => void): Promise<OutboxSummary> {
  const pushed = await pushOutbox(onStatus);
  const pulled = await pullOperationalRecords(onStatus);
  let pulledPanels = 0;
  try {
    // Catches panel changes that aren't tied to any issue/replacement -- historical Excel
    // corrections, field location fixes, etc. -- which pullOperationalRecords has no way to
    // know about on its own (it only re-fetches panels REFERENCED by newly-pulled issues/
    // replacements). Cheap: only pulls what changed since this device's own last checkpoint,
    // not the whole ~378k-row table.
    onStatus?.('Checking for updated panels...');
    pulledPanels = await pullPanelsUpdatedSince();
  } catch (err) {
    console.error('Downloading updated panels failed:', err);
  }
  try {
    onStatus?.('Downloading tracker GPS data...');
    await pullTrackerPicas();
  } catch (err) {
    // Don't fail the whole sync cycle over this -- GPS lookup is a bonus feature, not core.
    console.error('Downloading tracker picas failed:', err);
  }
  try {
    // The admin PIN is shared across every device (not a purely local browser setting) so a
    // PIN set on one device protects all of them, including a brand new device/person that
    // never had a chance to configure one -- the server is the source of truth whenever a
    // shared value exists.
    const sharedPin = await pullAdminPinHash();
    if (sharedPin !== undefined && sharedPin !== useSettings.getState().adminPin) {
      useSettings.getState().setAdminPin(sharedPin);
    }
  } catch (err) {
    console.error('Downloading shared admin PIN failed:', err);
  }
  return {
    pushedIssues: pushed.issues,
    pushedReplacements: pushed.replacements,
    pushedEvents: pushed.events,
    pushedPhotos: pushed.photos,
    pulledIssues: pulled.issues,
    pulledReplacements: pulled.replacements,
    pulledEvents: pulled.events,
    pulledPhotos: pulled.photos,
    pulledPanels,
  };
}

/** Helper so page components don't need to remember the id/timestamp boilerplate every
 * time they log an activity event. */
export function buildActivityEvent(input: Omit<ActivityEvent, 'eventId' | 'timestamp' | 'syncStatus'>): ActivityEvent {
  return { ...input, eventId: newId('evt'), timestamp: nowIso(), syncStatus: 'pending' };
}
