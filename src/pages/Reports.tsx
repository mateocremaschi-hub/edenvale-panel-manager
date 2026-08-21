import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@/lib/db';
import { useSession } from '@/store/session';
import { newId } from '@/lib/id';
import { nowIso, formatDateTime } from '@/lib/time';
import type { Issue, IssueType, Severity } from '@/lib/types';
import BarcodeScanner from '@/components/BarcodeScanner';

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
  const navigate = useNavigate();
  const { operatorId, operatorName } = useSession();
  const issues = useLiveQuery(() => db.issues.orderBy('reportedDate').reverse().toArray(), [], []);
  const panels = useLiveQuery(() => db.panels.toArray(), [], []);
  const panelByLocation = useMemo(() => new Map((panels ?? []).map((p) => [p.locationId, p])), [panels]);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);

  // Self-healing: if a panel already shows "replaced" but its report never got updated to
  // match (whatever caused that), fix it quietly in the background instead of leaving the
  // report stuck open forever.
  useEffect(() => {
    if (!issues || !panels) return;
    const stale = issues.filter((i) => {
      if (i.status === 'replaced' || i.status === 'closed') return false;
      return panelByLocation.get(i.locationId)?.status === 'replaced';
    });
    if (stale.length === 0) return;
    db.issues.bulkPut(stale.map((i) => ({ ...i, status: 'replaced' as const, syncStatus: 'pending' as const })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, panels]);

  const [open, setOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [serialInput, setSerialInput] = useState('');
  const [locationId, setLocationId] = useState('');
  const [showLocationFallback, setShowLocationFallback] = useState(false);
  const [current, setCurrent] = useState<{ locationId: string; serial: string; panelId: string } | null>(null);

  const [type, setType] = useState<IssueType>('broken_glass');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [description, setDescription] = useState('');
  const [requiresReplacement, setRequiresReplacement] = useState(false);
  const [monitorOnly, setMonitorOnly] = useState(false);
  const [immediateSafety, setImmediateSafety] = useState(false);
  const [sunManagerId, setSunManagerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setOpen(false);
    setCurrent(null);
    setSerialInput('');
    setLocationId('');
    setShowLocationFallback(false);
    setDescription('');
    setSunManagerId('');
    setRequiresReplacement(false);
    setMonitorOnly(false);
    setImmediateSafety(false);
    setError(null);
  }

  async function lookupBySerial(serial: string) {
    setError(null);
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
    setCurrent({ locationId: panel.locationId, serial: panel.serialNumber, panelId: panel.panelId });
  }

  async function loadPanelByLocation() {
    setError(null);
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
    setCurrent({ locationId: loc.locationId, serial: panel.serialNumber, panelId: panel.panelId });
  }

  function handleScanResult(text: string) {
    setScannerOpen(false);
    lookupBySerial(text);
  }

  async function submit() {
    if (!current) return;
    setError(null);
    setSaving(true);
    try {
      const issueId = newId('iss');
      const issue: Issue = {
        issueId,
        locationId: current.locationId,
        panelIdAtReport: current.panelId,
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
        syncStatus: 'pending',
      };
      await db.transaction('rw', db.issues, db.panels, db.activityEvents, async () => {
        await db.issues.add(issue);
        await db.panels.update(current.panelId, {
          status: requiresReplacement ? 'pending_replacement' : 'issue_reported',
        });
        await db.activityEvents.add({
          eventId: newId('evt'),
          entityType: 'issue',
          entityId: issueId,
          action: 'issue_created',
          operator: operatorId!,
          timestamp: nowIso(),
          syncStatus: 'pending',
        });
      });
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  function markAsReplaced(issue: Issue) {
    navigate(`/replacements?panelId=${encodeURIComponent(issue.panelIdAtReport)}&issueId=${encodeURIComponent(issue.issueId)}`);
  }

  async function closeIssue(issue: Issue) {
    await db.transaction('rw', db.issues, db.activityEvents, async () => {
      await db.issues.update(issue.issueId, { status: 'closed' });
      await db.activityEvents.add({
        eventId: newId('evt'),
        entityType: 'issue',
        entityId: issue.issueId,
        action: 'issue_closed',
        previousValue: issue.status,
        newValue: 'closed',
        operator: operatorId!,
        timestamp: nowIso(),
        syncStatus: 'pending',
      });
    });
    setExpandedIssueId(null);
  }

  async function reopenIssue(issue: Issue) {
    await db.transaction('rw', db.issues, db.activityEvents, async () => {
      await db.issues.update(issue.issueId, { status: 'reopened' });
      await db.activityEvents.add({
        eventId: newId('evt'),
        entityType: 'issue',
        entityId: issue.issueId,
        action: 'issue_reopened',
        previousValue: issue.status,
        newValue: 'reopened',
        operator: operatorId!,
        timestamp: nowIso(),
        syncStatus: 'pending',
      });
    });
    setExpandedIssueId(null);
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

      {scannerOpen && (
        <BarcodeScanner title="Scan the panel's barcode" onResult={handleScanResult} onClose={() => setScannerOpen(false)} />
      )}

      {open && (
        <div className="mb-4 rounded-xl border border-border bg-bg-panel p-4">
          <div className="mb-3 text-xs text-slate-400">
            Reporting as <span className="text-slate-200">{operatorName}</span>.
          </div>
          {error && (
            <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-sm text-status-pending">{error}</div>
          )}

          {!current ? (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setScannerOpen(true)}
                className="rounded-lg border border-accent-blue px-4 py-3 text-sm font-semibold text-accent-blue"
              >
                📷 Scan panel barcode
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
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg p-3 text-sm">
                <div>
                  <div className="text-slate-400">Reporting on</div>
                  <div className="font-mono text-slate-100">{current.serial}</div>
                  <div className="text-xs text-slate-500">{current.locationId}</div>
                </div>
                <button onClick={() => setCurrent(null)} className="text-xs text-accent-blue">
                  Change panel
                </button>
              </div>
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
                  disabled={saving || !description}
                  className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Save report
                </button>
                <button onClick={resetForm} className="rounded-lg border border-border px-4 py-2 text-sm text-slate-300">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(issues ?? []).map((i) => {
          const expanded = expandedIssueId === i.issueId;
          const panelNow = panelByLocation.get(i.locationId);
          const alreadyReplacedInReality = panelNow?.status === 'replaced';
          const isActionable = i.status !== 'replaced' && i.status !== 'closed' && !alreadyReplacedInReality;
          return (
            <div key={i.issueId} className="rounded-xl border border-border bg-bg-panel p-3">
              <button
                onClick={() => setExpandedIssueId(expanded ? null : i.issueId)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-sm font-medium text-slate-100">{i.locationId}</span>
                <span className="text-xs text-slate-400">{formatDateTime(i.reportedDate)}</span>
              </button>
              <div className="mt-1 text-xs text-slate-400">
                {ISSUE_TYPES.find((it) => it.value === i.type)?.label} · {i.severity} · {i.status}
              </div>
              {i.description && <div className="mt-1 text-sm text-slate-300">{i.description}</div>}
              {expanded && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {isActionable ? (
                    <>
                      <button
                        onClick={() => markAsReplaced(i)}
                        className="rounded-lg bg-accent-blue px-3 py-2 text-xs font-semibold text-white"
                      >
                        🔧 Mark as replaced
                      </button>
                      <button
                        onClick={() => closeIssue(i)}
                        className="rounded-lg border border-border px-3 py-2 text-xs text-slate-300"
                      >
                        Close without replacing
                      </button>
                    </>
                  ) : (
                    <>
                      {alreadyReplacedInReality && i.status !== 'replaced' && i.status !== 'closed' && (
                        <span className="text-xs text-slate-500">
                          The panel at this location already shows "replaced" -- marking this report to match.
                        </span>
                      )}
                      <button
                        onClick={() => reopenIssue(i)}
                        className="rounded-lg border border-border px-3 py-2 text-xs text-slate-300"
                      >
                        Reopen
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
