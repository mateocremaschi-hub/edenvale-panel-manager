import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';
import { newId } from '@/lib/id';
import { nowIso, formatDateTime } from '@/lib/time';
import type { Replacement } from '@/lib/types';

export default function Replacements() {
  const { operatorId, operatorName } = useSession();
  const { voltageMin, voltageMax } = useSettings();
  const replacements = useLiveQuery(() => db.replacements.orderBy('replacementDate').reverse().toArray(), [], []);

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
  const [current, setCurrent] = useState<{
    locationId: string;
    serial: string;
    voltage?: number;
    panelId: string;
  } | null>(null);

  async function loadPanel() {
    setError(null);
    setWarning(null);
    setCurrent(null);
    const loc = await db.locations.get(locationId.trim());
    if (!loc) {
      setError(`Location "${locationId}" not found.`);
      return;
    }
    const panel = await db.panels.get(loc.locationId);
    if (!panel) {
      setError('No panel currently recorded at that location.');
      return;
    }
    setCurrent({ locationId: loc.locationId, serial: panel.serialNumber, voltage: panel.voltage, panelId: panel.panelId });
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
        photoIds: [],
        notes,
        syncStatus: 'local',
      };
      await db.transaction('rw', db.replacements, db.panels, db.issues, db.activityEvents, async () => {
        await db.replacements.add(rec);
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
      setOpen(false);
      setCurrent(null);
      setLocationId('');
      setNewSerial('');
      setNewVoltage('');
      setReason('');
      setSunManagerId('');
      setNotes('');
      setWarning(null);
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
            <div className="flex gap-2">
              <input
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="Location code, e.g. 1.1.1.1.1.1"
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
              />
              <button onClick={loadPanel} className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-semibold text-bg-panel">
                Load
              </button>
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
              <input
                value={newSerial}
                onChange={(e) => setNewSerial(e.target.value)}
                placeholder="New serial number"
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
              />
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

      <div className="flex flex-col gap-2">
        {(replacements ?? []).map((r) => (
          <div key={r.replacementId} className="rounded-xl border border-border bg-bg-panel p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-100">{r.locationId}</span>
              <span className="text-xs text-slate-400">{formatDateTime(r.replacementDate)}</span>
            </div>
            <div className="mt-1 font-mono text-xs text-slate-500">
              {r.removedSerial} → {r.installedSerial}
            </div>
            {r.reason && <div className="mt-1 text-slate-300">{r.reason}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
