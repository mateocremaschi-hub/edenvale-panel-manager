import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';
import { newId } from '@/lib/id';
import { nowIso, formatDateTime } from '@/lib/time';
import { compressImage } from '@/lib/photo';
import { generateReplacementsPdf } from '@/lib/pdfReport';
import type { Replacement, Photo } from '@/lib/types';
import BarcodeScanner from '@/components/BarcodeScanner';

interface PendingPhoto {
  file: File;
  previewUrl: string;
  role: 'before' | 'after';
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
    issueId?: string;
  } | null>(null);

  const [blockFilter, setBlockFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedPhotos, setExpandedPhotos] = useState<string | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [showLocationFallback, setShowLocationFallback] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const panelId = searchParams.get('panelId');
    const issueId = searchParams.get('issueId') ?? undefined;
    if (!panelId) return;
    db.panels.get(panelId).then((panel) => {
      if (panel) {
        setLocationId(panel.locationId);
        setCurrent({ locationId: panel.locationId, serial: panel.serialNumber, voltage: panel.voltage, panelId: panel.panelId, issueId });
        setOpen(true);
      } else {
        setError(`Panel "${panelId}" not found (it may have been removed from the last import).`);
      }
    });
    // Clear the params so a later manual "New replacement" doesn't reopen this one.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('panelId');
      next.delete('issueId');
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

  const [notFoundSerial, setNotFoundSerial] = useState<string | null>(null);
  const [reconcileStringCode, setReconcileStringCode] = useState('');
  const [reconcilePosition, setReconcilePosition] = useState('');
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  async function lookupBySerial(serial: string) {
    setError(null);
    setWarning(null);
    setCurrent(null);
    setNotFoundSerial(null);
    const trimmed = serial.trim();
    if (!trimmed) {
      setError('Type or scan a serial number.');
      return;
    }
    const panel = await db.panels.where('serialNumber').equals(trimmed).first();
    if (!panel) {
      setNotFoundSerial(trimmed);
      return;
    }
    setLocationId(panel.locationId);
    setCurrent({ locationId: panel.locationId, serial: panel.serialNumber, voltage: panel.voltage, panelId: panel.panelId });
  }

  /** The scanned serial doesn't match anything on record -- most likely this panel was
   * swapped before without being logged. Rather than block the operator, let them say
   * WHERE it is (string code + position) and continue straight into the normal replacement
   * form, pre-filled with the serial they just read, so what's really in the field gets
   * saved either way. */
  async function registerFieldDiscrepancy() {
    setReconcileError(null);
    const code = reconcileStringCode.trim();
    const pos = Number(reconcilePosition);
    if (!code || !reconcilePosition || !Number.isInteger(pos) || pos < 1 || pos > 28) {
      setReconcileError('Enter the string code and a panel position from 1 to 28.');
      return;
    }
    const locId = `${code}.${pos}`;
    const loc = await db.locations.get(locId);
    if (!loc) {
      setReconcileError(`No location "${locId}" in the farm layout -- double check the string code and position.`);
      return;
    }
    const oldPanel = await db.panels.get(locId);
    setLocationId(locId);
    setCurrent({
      locationId: locId,
      serial: oldPanel?.serialNumber ?? 'unknown (no prior record)',
      voltage: oldPanel?.voltage,
      panelId: locId,
    });
    setNewSerial(notFoundSerial ?? '');
    setReason('Found a different panel in the field -- likely replaced before without being logged.');
    setNotFoundSerial(null);
    setReconcileStringCode('');
    setReconcilePosition('');
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
    const next: PendingPhoto[] = Array.from(files).map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      role: 'after' as const,
    }));
    setPhotos((p) => [...p, ...next]);
  }

  function togglePhotoRole(index: number) {
    setPhotos((p) => p.map((ph, i) => (i === index ? { ...ph, role: ph.role === 'before' ? 'after' : 'before' } : ph)));
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
            photoRole: p.role,
            syncStatus: 'pending' as const,
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
        relatedIssueId: current.issueId,
        photoIds: photoRecords.map((p) => p.photoId),
        notes,
        syncStatus: 'pending',
      };
      await db.transaction('rw', db.replacements, db.panels, db.issues, db.activityEvents, db.photos, async () => {
        await db.replacements.add(rec);
        if (photoRecords.length) await db.photos.bulkAdd(photoRecords);
        await db.panels.update(current.panelId, {
          serialNumber: serial,
          voltage: voltageNum,
          status: 'replaced',
        });
        // Close every open report at this location, not just one -- if more than one was
        // ever logged here, a replacement resolves all of them, not just whichever happened
        // to be found first.
        const openIssues = await db.issues
          .where('locationId')
          .equals(current.locationId)
          .filter((i) => i.status !== 'closed' && i.status !== 'replaced')
          .toArray();
        for (const issue of openIssues) {
          await db.issues.update(issue.issueId, { status: 'replaced' });
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
          syncStatus: 'pending',
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

  async function updateSm(replacementId: string, patch: { smUploaded?: boolean; sunManagerId?: string }) {
    await db.replacements.update(replacementId, { ...patch, syncStatus: 'pending' });
  }

  const [pdfFrom, setPdfFrom] = useState('');
  const [pdfTo, setPdfTo] = useState('');
  const [pdfBlock, setPdfBlock] = useState('');
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  async function downloadPdf() {
    setPdfError(null);
    setPdfGenerating(true);
    try {
      const blob = await generateReplacementsPdf({ fromDate: pdfFrom || undefined, toDate: pdfTo || undefined, block: pdfBlock || undefined }, setPdfStatus);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const parts = ['replacement-report', pdfBlock ? `block-${pdfBlock}` : 'all-blocks', pdfFrom || 'start', pdfTo || 'now'];
      a.download = `${parts.join('_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfGenerating(false);
      setPdfStatus(null);
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

              {notFoundSerial && (
                <div className="rounded-lg border border-status-observation/40 bg-status-observation/10 p-3">
                  <p className="text-sm text-slate-200">
                    No panel on record with serial <span className="font-mono">{notFoundSerial}</span>.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    This usually means it was already replaced in the field without being logged. Tell me
                    where it is and I'll register it so the record matches what's really out there.
                  </p>
                  {reconcileError && (
                    <div className="mt-2 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{reconcileError}</div>
                  )}
                  <div className="mt-2 flex flex-col gap-2">
                    <input
                      value={reconcileStringCode}
                      onChange={(e) => setReconcileStringCode(e.target.value)}
                      placeholder="String code, e.g. 31.1.4.2.5"
                      className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                    />
                    <input
                      value={reconcilePosition}
                      onChange={(e) => setReconcilePosition(e.target.value)}
                      type="number"
                      min={1}
                      max={28}
                      placeholder="Panel position (1-28)"
                      className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={registerFieldDiscrepancy}
                        className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white"
                      >
                        Register what's actually there
                      </button>
                      <button
                        onClick={() => setNotFoundSerial(null)}
                        className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
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
                    <div key={i} className="flex flex-col items-center gap-1">
                      <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                        <img src={p.previewUrl} className="h-full w-full object-cover" alt="" />
                        <button
                          onClick={() => removePhoto(i)}
                          className="absolute right-0 top-0 rounded-bl bg-black/60 px-1.5 text-xs text-white"
                        >
                          ×
                        </button>
                      </div>
                      <button
                        onClick={() => togglePhotoRole(i)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.role === 'before' ? 'bg-status-pending/30 text-status-pending' : 'bg-status-replaced/30 text-status-replaced'
                        }`}
                      >
                        {p.role === 'before' ? 'Before' : 'After'}
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

      <div className="mb-3 rounded-xl border border-border bg-bg-panel p-4">
        <button onClick={() => setPdfOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-sm font-semibold text-slate-200">📄 Download PDF report</span>
          <span className="text-xs text-accent-blue">{pdfOpen ? 'Hide' : 'Show'}</span>
        </button>
        {pdfOpen && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-slate-500">
              Includes location, dates, serials, who replaced it, voltage, SunManager status, and any
              before/after photos attached.
            </p>
            {pdfError && <div className="rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{pdfError}</div>}
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">From</label>
                <input
                  type="date"
                  value={pdfFrom}
                  onChange={(e) => setPdfFrom(e.target.value)}
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">To</label>
                <input
                  type="date"
                  value={pdfTo}
                  onChange={(e) => setPdfTo(e.target.value)}
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Block</label>
                <select
                  value={pdfBlock}
                  onChange={(e) => setPdfBlock(e.target.value)}
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">All blocks</option>
                  {blocks.map((b) => (
                    <option key={b} value={b}>
                      Block {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              onClick={downloadPdf}
              disabled={pdfGenerating}
              className="self-start rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {pdfGenerating ? pdfStatus || 'Generating...' : 'Download PDF'}
            </button>
          </div>
        )}
      </div>

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
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{formatDateTime(r.replacementDate)}</span>
                  <label className="flex items-center gap-1 text-xs text-slate-400" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={!!r.smUploaded}
                      onChange={(e) => updateSm(r.replacementId, { smUploaded: e.target.checked })}
                    />
                    SM
                  </label>
                  <input
                    value={r.sunManagerId ?? ''}
                    onChange={(e) => updateSm(r.replacementId, { sunManagerId: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="ID SM"
                    maxLength={4}
                    className="w-14 rounded border border-border bg-bg px-1.5 py-0.5 text-center text-xs text-slate-100"
                  />
                </div>
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
