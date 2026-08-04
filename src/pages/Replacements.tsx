import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';
import { newId } from '@/lib/id';
import { nowIso, formatDateTime } from '@/lib/time';
import { compressImage } from '@/lib/photo';
import type { Replacement, Photo } from '@/lib/types';
import BarcodeScanner from '@/components/BarcodeScanner';

interface PendingPhoto {
  file: File;
  previewUrl: string;
}

export default function Replacements() {
  const { operatorId, operatorName } = useSession();
  const { voltageMin, voltageMax } = useSettings();
  const replacements = useLiveQuery(() => db.replacements.orderBy('replacementDate').reverse().toArray(), [], []);
  const allPhotos = useLiveQuery(() => db.photos.where('relatedType').equals('replacement').toArray(), [], []);

  const photosByReplacement = useMemo(() => {
    const map = new Map<string, Photo[]>();
    for (const p of allPhotos ?? []) {
      const arr = map.get(p.relatedId) ?? [];
      arr.push(p);
      map.set(p.relatedId, arr);
    }
    return map;
  }, [allPhotos]);

  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [newSerial, setNewSerial] = useState('');
  const [newVoltage, setNewVoltage] = useState('');
  const [reason, setReason] = useState('');
  const [sunManagerId, setSunManagerId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scannerMode, setScannerMode] = useState<'removed' | 'new' | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [current, setCurrent] = useState<{
    locationId: string;
    serial: string;
    voltage?: number;
    panelId: string;
  } | null>(null);

  const [blockFilter, setBlockFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedPhotos, setExpandedPhotos] = useState<string | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [showLocationFallback, setShowLocationFallback] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const panelId = searchParams.get('panelId');
    if (!panelId) return;
    db.panels.get(panelId).then((panel) => {
      if (panel) {
        setLocationId(panel.locationId);
        setCurrent({ locationId: panel.locationId, serial: panel.serialNumber, voltage: panel.voltage, panelId: panel.panelId });
        setOpen(true);
      } else {
        setError(`Panel "${panelId}" not found (it may have been removed from the last import).`);
      }
    });
    // Clear the param so a later manual "New replacement" doesn't reopen this one.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('panelId');
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocks = useMemo(() => {
    const set = new Set((replacements ?? []).map((r) => r.locationId.split('.')[0]));
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [replacements]);

  const filteredReplacements = useMemo(() => {
    return (replacements ?? []).filter((r) => {
      if (blockFilter && r.locationId.split('.')[0] !== blockFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.locationId.toLowerCase().includes(q) &&
          !r.removedSerial.toLowerCase().includes(q) &&
          !r.installedSerial.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [replacements, blockFilter, search]);

  async function loadPanelByLocation() {
    setError(null);
    setWarning(null);
    setCurrent(null);
    const typed = locationId.trim();
    if (!typed) {
      setError('Type a location code.');
      return;
    }
    const loc = await db.locations.get(typed);
    if (!loc) {
      setError(`Location "${typed}" not found.`);
      return;
    }
    const panel = await db.panels.get(loc.locationId);
    if (!panel) {
      setError('No panel currently recorded at that location.');
      return;
    }
    setCurrent({ locationId: loc.locationId, serial: panel.serialNumber, voltage: panel.voltage, panelId: panel.panelId });
  }

  async function lookupBySerial(serial: string) {
    setError(null);
    setWarning(null);
    setCurrent(null);
    const trimmed = serial.trim();
    if (!trimmed) {
      setError('Type or scan a serial number.');
      return;
    }
    const panel = await db.panels.where('serialNumber').equals(trimmed).first();
    if (!panel) {
      setError(`No panel currently installed with serial "${trimmed}". Try scanning again, or use "Enter location code instead" below.`);
      return;
    }
    setLocationId(panel.locationId);
    setCurrent({ locationId: panel.locationId, serial: panel.serialNumber, voltage: panel.voltage, panelId: panel.panelId });
  }

  function handleScanResult(text: string) {
    const mode = scannerMode;
    setScannerMode(null);
    if (mode === 'removed') {
      lookupBySerial(text);
    } else if (mode === 'new') {
      setNewSerial(text);
    }
  }

  function addPhotos(files: FileList) {
    const next: PendingPhoto[] = Array.from(files).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setPhotos((p) => [...p, ...next]);
  }

  function removePhoto(index: number) {
    setPhotos((p) => {
      URL.revokeObjectURL(p[index].previewUrl);
      return p.filter((_, i) => i !== index);
    });
  }

  async function confirmReplacement() {
    if (!current) return;
    setError(null);
    const serial = newSerial.trim();
    if (!serial) {
      setError('Enter the new serial number.');
      return;
    }
    // Validation: the new serial cannot already be active at a different location.
    const clash = await db.panels.where('serialNumber').equals(serial).first();
    if (clash && clash.locationId !== current.locationId) {
      setError(`Serial ${serial} is already active at location ${clash.locationId}.`);
      return;
    }
    const voltageNum = newVoltage ? Number(newVoltage) : undefined;
    if (voltageNum !== undefined && (voltageNum < voltageMin || voltageNum > voltageMax)) {
      setWarning(
        `Voltage ${voltageNum}V is outside the configured range (${voltageMin}-${voltageMax}V). Saved anyway — double-check the reading.`
      );
    }

    setSaving(true);
    try {
      const replacementId = newId('rep');
      const photoRecords: Photo[] = await Promise.all(
        photos.map(async (p) => {
          const blob = await compressImage(p.file);
          return {
            photoId: newId('photo'),
            relatedType: 'replacement' as const,
            relatedId: replacementId,
            blob,
            takenAt: nowIso(),
            author: operatorId!,
            syncStatus: 'local' as const,
          };
        })
      );
      const rec: Replacement = {
        replacementId,
        locationId: current.locationId,
        removedPanelId: current.panelId,
        removedSerial: current.serial,
        installedPanelId: current.panelId, // the physical location id stays stable across serials
        installedSerial: serial,
        oldVoltage: current.voltage,
        newVoltage: voltageNum,
        replacementDate: nowIso(),
        replacedBy: operatorId!,
        sunManagerId: sunManagerId || undefined,
        reason,
        photoIds: photoRecords.map((p) => p.photoId),
        notes,
        syncStatus: 'local',
      };
      await db.transaction('rw', db.replacements, db.panels, db.issues, db.activityEvents, db.photos, async () => {
        await db.replacements.add(rec);
        if (photoRecords.length) await db.photos.bulkAdd(photoRecords);
        await db.panels.update(current.panelId, {
          serialNumber: serial,
          voltage: voltageNum,
          status: 'replaced',
        });
        const openIssue = await db.issues
          .where('locationId')
          .equals(current.locationId)
          .filter((i) => i.status !== 'closed')
          .first();
        if (openIssue) {
          await db.issues.update(openIssue.issueId, { status: 'closed' });
        }
        await db.activityEvents.add({
          eventId: newId('evt'),
          entityType: 'replacement',
          entityId: replacementId,
          action: 'replacement_confirmed',
          previousValue: current.serial,
          newValue: serial,
          operator: operatorId!,
          timestamp: nowIso(),
          syncStatus: 'local',
        });
      });
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setOpen(false);
      setCurrent(null);
      setLocationId('');
      setNewSerial('');
      setNewVoltage('');
      setReason('');
      setSunManagerId('');
      setNotes('');
      setWarning(null);
      setPhotos([]);
      setSerialInput('');
      setShowLocationFallback(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Replacements</h1>
        <button
          onClick={() => setOpen(true)}
          className="rounded-xl bg-accent-blue px-4 py-2 text-sm font-semibold text-white active:opacity-80"
        >
          + New replacement
        </button>
      </div>

      {scannerMode && (
        <BarcodeScanner
          title={scannerMode === 'removed' ? 'Scan the panel being removed' : 'Scan the new panel'}
          onResult={handleScanResult}
          onClose={() => setScannerMode(null)}
        />
      )}

      {open && (
        <div className="mb-4 rounded-xl border border-border bg-bg-panel p-4">
          <div className="mb-3 text-xs text-slate-400">
            Recording as <span className="text-slate-200">{operatorName}</span>.
          </div>
          {error && (
            <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-sm text-status-pending">{error}</div>
          )}
          {warning && (
            <div className="mb-3 rounded-lg bg-status-observation/20 p-2 text-sm text-status-observation">
              {warning}
            </div>
          )}

          {!current ? (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setScannerMode('removed')}
                className="rounded-lg border border-accent-blue px-4 py-3 text-sm font-semibold text-accent-blue"
              >
                📷 Scan removed panel barcode
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex gap-2">
                <input
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && lookupBySerial(serialInput)}
                  placeholder="Type the serial number"
                  className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                />
                <button
                  onClick={() => lookupBySerial(serialInput)}
                  className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-semibold text-bg-panel"
                >
                  Find
                </button>
              </div>
              <button
                onClick={() => setShowLocationFallback((v) => !v)}
                className="self-start text-xs text-slate-500 underline"
              >
                Can't scan or find the serial? Enter the location code instead
              </button>
              {showLocationFallback && (
                <div className="flex gap-2">
                  <input
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    placeholder="Location code, e.g. 1.1.1.1.1.1"
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                  />
                  <button onClick={loadPanelByLocation} className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300">
                    Load
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-bg p-3 text-sm">
                <div className="text-slate-400">Removing</div>
                <div className="font-mono text-slate-100">{current.serial}</div>
                <div className="text-xs text-slate-500">
                  {current.locationId} {current.voltage ? `· ${current.voltage.toFixed(2)}V` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  value={newSerial}
                  onChange={(e) => setNewSerial(e.target.value)}
                  placeholder="New serial number"
                  className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                />
                <button
                  onClick={() => setScannerMode('new')}
                  className="rounded-lg border border-accent-blue px-3 py-2 text-sm text-accent-blue"
                  title="Scan new panel barcode"
                >
                  📷
                </button>
              </div>
              <input
                value={newVoltage}
                onChange={(e) => setNewVoltage(e.target.value)}
                placeholder="New voltage (V)"
                type="number"
                step="0.01"
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
              />
              <input
                value={sunManagerId}
                onChange={(e) => setSunManagerId(e.target.value)}
                placeholder="SunManager ID (WO number, optional)"
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
              />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                rows={2}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
              />

              <div>
                <label className="mb-1 block text-xs text-slate-400">Photos (before/after)</label>
                <div className="flex flex-wrap gap-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                      <img src={p.previewUrl} className="h-full w-full object-cover" alt="" />
                      <button
                        onClick={() => removePhoto(i)}
                        className="absolute right-0 top-0 rounded-bl bg-black/60 px-1.5 text-xs text-white"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-2xl text-slate-500">
                    +
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="hidden"
                      onChange={(e) => e.target.files && addPhotos(e.target.files)}
                    />
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={confirmReplacement}
                  disabled={saving}
                  className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Confirm replacement
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    setCurrent(null);
                    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                    setPhotos([]);
                    setSerialInput('');
                    setShowLocationFallback(false);
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={blockFilter}
          onChange={(e) => setBlockFilter(e.target.value)}
          className="rounded-lg border border-border bg-bg-panel px-3 py-2 text-sm text-slate-100"
        >
          <option value="">All blocks</option>
          {blocks.map((b) => (
            <option key={b} value={b}>
              Block {b}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by serial or location"
          className="flex-1 rounded-lg border border-border bg-bg-panel px-3 py-2 text-sm text-slate-100"
        />
      </div>

      <div className="flex flex-col gap-2">
        {filteredReplacements.map((r) => {
          const photosForRow = photosByReplacement.get(r.replacementId) ?? [];
          return (
            <div key={r.replacementId} className="rounded-xl border border-border bg-bg-panel p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-100">{r.locationId}</span>
                <span className="text-xs text-slate-400">{formatDateTime(r.replacementDate)}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-slate-500">
                {r.removedSerial} → {r.installedSerial}
              </div>
              {r.reason && <div className="mt-1 text-slate-300">{r.reason}</div>}
              {photosForRow.length > 0 && (
                <button
                  onClick={() => setExpandedPhotos(expandedPhotos === r.replacementId ? null : r.replacementId)}
                  className="mt-1 text-xs text-accent-blue"
                >
                  📷 {photosForRow.length} photo{photosForRow.length > 1 ? 's' : ''}
                </button>
              )}
              {expandedPhotos === r.replacementId && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {photosForRow.map((p) => (
                    <img
                      key={p.photoId}
                      src={URL.createObjectURL(p.blob)}
                      className="h-16 w-16 rounded-lg border border-border object-cover"
                      alt=""
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filteredReplacements.length === 0 && <p className="text-sm text-slate-500">No replacements match those filters.</p>}
      </div>
    </div>
  );
}
