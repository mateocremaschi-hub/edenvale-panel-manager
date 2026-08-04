import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useSession } from '@/store/session';
import { newId } from '@/lib/id';
import { nowIso, formatDateTime } from '@/lib/time';
import type { Issue, IssueType, Severity } from '@/lib/types';

const ISSUE_TYPES: { value: IssueType; label: string }[] = [
  { value: 'broken_glass', label: 'Broken glass' },
  { value: 'cracked_panel', label: 'Cracked panel' },
  { value: 'hotspot', label: 'Hotspot' },
  { value: 'burn_mark', label: 'Burn mark' },
  { value: 'junction_box_issue', label: 'Junction box issue' },
  { value: 'connector_or_cable_damage', label: 'Connector or cable damage' },
  { value: 'frame_damage', label: 'Frame damage' },
  { value: 'delamination', label: 'Delamination' },
  { value: 'yellowing', label: 'Yellowing' },
  { value: 'low_voltage', label: 'Low voltage' },
  { value: 'no_output', label: 'No output' },
  { value: 'loose_or_missing_panel', label: 'Loose or missing panel' },
  { value: 'tracker_related_damage', label: 'Tracker-related damage' },
  // #1 real-world cause found in the farm's own replacement history (241 of 348 records).
  { value: 'bypass_diode_activated', label: 'Bypass diode activated' },
  { value: 'other', label: 'Other' },
];

export default function Reports() {
  const { operatorId, operatorName } = useSession();
  const issues = useLiveQuery(() => db.issues.orderBy('reportedDate').reverse().toArray(), [], []);

  const [open, setOpen] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [type, setType] = useState<IssueType>('broken_glass');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [description, setDescription] = useState('');
  const [requiresReplacement, setRequiresReplacement] = useState(false);
  const [monitorOnly, setMonitorOnly] = useState(false);
  const [immediateSafety, setImmediateSafety] = useState(false);
  const [sunManagerId, setSunManagerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const loc = await db.locations.get(locationId.trim());
    if (!loc) {
      setError(`Location "${locationId}" not found. Use the exact location code (e.g. 1.1.1.1.1.1).`);
      return;
    }
    setSaving(true);
    try {
      const panel = await db.panels.get(loc.locationId);
      const issueId = newId('iss');
      const issue: Issue = {
        issueId,
        locationId: loc.locationId,
        panelIdAtReport: panel?.panelId ?? loc.locationId,
        type,
        severity,
        description,
        status: 'open',
        reportedBy: operatorId!,
        reportedDate: nowIso(),
        sunManagerId: sunManagerId || undefined,
        requiresReplacement,
        monitorOnly,
        immediateSafetyConcern: immediateSafety,
        photoIds: [],
        syncStatus: 'local',
      };
      await db.transaction('rw', db.issues, db.panels, db.activityEvents, async () => {
        await db.issues.add(issue);
        if (panel) {
          await db.panels.update(panel.panelId, {
            status: requiresReplacement ? 'pending_replacement' : 'issue_reported',
          });
        }
        await db.activityEvents.add({
          eventId: newId('evt'),
          entityType: 'issue',
          entityId: issueId,
          action: 'issue_created',
          operator: operatorId!,
          timestamp: nowIso(),
          syncStatus: 'local',
        });
      });
      setOpen(false);
      setLocationId('');
      setDescription('');
      setSunManagerId('');
      setRequiresReplacement(false);
      setMonitorOnly(false);
      setImmediateSafety(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Reports</h1>
        <button
          onClick={() => setOpen(true)}
          className="rounded-xl bg-accent-blue px-4 py-2 text-sm font-semibold text-white active:opacity-80"
        >
          + Report issue
        </button>
      </div>

      {open && (
        <div className="mb-4 rounded-xl border border-border bg-bg-panel p-4">
          <div className="mb-3 text-xs text-slate-400">
            Reporting as <span className="text-slate-200">{operatorName}</span>. Picking the panel from the
            map comes in Etapa 3 — for now, type the location code exactly (see it in Search or Records).
          </div>
          {error && (
            <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-sm text-status-pending">{error}</div>
          )}
          <div className="flex flex-col gap-3">
            <input
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="Location code, e.g. 1.1.1.1.1.1"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as IssueType)}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
            >
              {ISSUE_TYPES.map((it) => (
                <option key={it.value} value={it.value}>
                  {it.label}
                </option>
              ))}
            </select>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="immediate_safety_concern">Immediate safety concern</option>
            </select>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
            />
            <input
              value={sunManagerId}
              onChange={(e) => setSunManagerId(e.target.value)}
              placeholder="SunManager ID (optional, can be added later)"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={requiresReplacement}
                onChange={(e) => setRequiresReplacement(e.target.checked)}
              />
              Requires replacement
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={monitorOnly} onChange={(e) => setMonitorOnly(e.target.checked)} />
              Monitor only
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={immediateSafety}
                onChange={(e) => setImmediateSafety(e.target.checked)}
              />
              Immediate safety concern
            </label>
            <div className="flex gap-2">
              <button
                onClick={submit}
                disabled={saving || !locationId || !description}
                className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Save report
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(issues ?? []).map((i) => (
          <div key={i.issueId} className="rounded-xl border border-border bg-bg-panel p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-100">{i.locationId}</span>
              <span className="text-xs text-slate-400">{formatDateTime(i.reportedDate)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {ISSUE_TYPES.find((it) => it.value === i.type)?.label} · {i.severity} · {i.status}
            </div>
            {i.description && <div className="mt-1 text-sm text-slate-300">{i.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
