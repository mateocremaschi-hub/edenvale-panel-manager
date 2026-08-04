import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '@/lib/db';
import { loadBlockGeometry, blockImageUrl, type BlockGeometry, type GeometryString } from '@/lib/geometry';
import { parseStringCode } from '@/lib/locationCode';
import type { Panel } from '@/lib/types';
import ZoomPan from '@/components/ZoomPan';

interface StringAgg {
  total: number;
  issue: number;
  pending: number;
  replaced: number;
}

const LEGEND: { label: string; color: string }[] = [
  { label: 'Normal', color: 'rgba(91,114,144,0.55)' },
  { label: 'Issue reported', color: 'rgba(224,138,60,0.75)' },
  { label: 'Pending replacement', color: 'rgba(217,83,79,0.75)' },
  { label: 'Replaced', color: 'rgba(92,184,92,0.7)' },
];

function statusColor(agg: StringAgg | undefined): string {
  if (!agg || agg.total === 0) return LEGEND[0].color;
  if (agg.pending > 0) return LEGEND[2].color;
  if (agg.issue > 0) return LEGEND[1].color;
  if (agg.replaced === agg.total) return LEGEND[3].color;
  return LEGEND[0].color;
}

export default function BlockView() {
  const { blockNum } = useParams<{ blockNum: string }>();
  const navigate = useNavigate();
  const block = Number(blockNum);

  const [geometry, setGeometry] = useState<BlockGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusByString, setStatusByString] = useState<Map<string, StringAgg>>(new Map());
  const [selectedString, setSelectedString] = useState<GeometryString | null>(null);
  const [selectedPanels, setSelectedPanels] = useState<Panel[]>([]);

  useEffect(() => {
    if (!Number.isFinite(block)) return;
    setGeometry(null);
    setError(null);
    setSelectedString(null);
    loadBlockGeometry(block)
      .then(setGeometry)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [block]);

  useEffect(() => {
    if (!Number.isFinite(block)) return;
    let cancelled = false;
    async function run() {
      const locs = await db.locations.where('block').equals(block).toArray();
      if (locs.length === 0) return;
      const panels = await db.panels.bulkGet(locs.map((l) => l.locationId));
      const locById = new Map(locs.map((l) => [l.locationId, l]));
      const agg = new Map<string, StringAgg>();
      for (const p of panels) {
        if (!p) continue;
        const loc = locById.get(p.locationId);
        if (!loc) continue;
        const a = agg.get(loc.stringCode) ?? { total: 0, issue: 0, pending: 0, replaced: 0 };
        a.total++;
        if (p.status === 'issue_reported' || p.status === 'under_assessment' || p.status === 'monitoring') a.issue++;
        if (p.status === 'pending_replacement') a.pending++;
        if (p.status === 'replaced') a.replaced++;
        agg.set(loc.stringCode, a);
      }
      if (!cancelled) setStatusByString(agg);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [block]);

  async function openString(s: GeometryString) {
    setSelectedString(s);
    setSelectedPanels([]);
    const parts = parseStringCode(s.n);
    if (!parts) return;
    const prefix = `${parts.block}.${parts.inverter}.${parts.dcBox}.${parts.arrayBus}.${parts.string}.`;
    const locs = await db.locations.where('block').equals(block).toArray();
    const ids = locs.filter((l) => l.locationId.startsWith(prefix)).map((l) => l.locationId);
    const panels = await db.panels.bulkGet(ids);
    setSelectedPanels(
      panels
        .filter((p): p is Panel => !!p)
        .sort((a, b) => Number(a.locationId.split('.').pop()) - Number(b.locationId.split('.').pop()))
    );
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  if (!Number.isFinite(block)) {
    return <div className="text-sm text-status-pending">Invalid block number.</div>;
  }

  return (
    <div className="pb-20">
      <button onClick={() => navigate('/map')} className="mb-3 text-sm text-accent-blue">
        ← Back to map
      </button>
      <h1 className="mb-3 text-lg font-semibold text-slate-100">Block {block}</h1>

      {error && (
        <div className="rounded-lg bg-status-pending/20 p-3 text-sm text-status-pending">
          No plan geometry loaded for block {block} yet ({error}).
        </div>
      )}

      {!error && !geometry && <p className="text-sm text-slate-400">Loading real plan...</p>}

      {geometry && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {geometry.strings.length} strings · {Object.keys(geometry.trackers).length} trackers ·{' '}
            {geometry.dcbox.length} DC boxes. Pinch or scroll to zoom, drag to pan, tap a string.
          </p>
          <div className="mb-3 flex flex-wrap gap-3">
            {LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-3 w-3 rounded-sm border border-white/40" style={{ backgroundColor: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          <ZoomPan aspectRatio={geometry.w / geometry.h}>
            <img src={blockImageUrl(block)} alt={`Block ${block} plan`} className="absolute inset-0 h-full w-full" draggable={false} />
            {geometry.strings.map((s) => {
              const agg = statusByString.get(s.n);
              const left = ((s.x - s.w / 2) / geometry.w) * 100;
              const top = ((s.y - s.h / 2) / geometry.h) * 100;
              const width = (s.w / geometry.w) * 100;
              const height = (s.h / geometry.h) * 100;
              const isSelected = selectedString?.n === s.n;
              return (
                <button
                  key={s.n}
                  onClick={() => openString(s)}
                  title={s.n}
                  className="absolute rounded-[1px] transition-[outline-width]"
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${width}%`,
                    height: `${height}%`,
                    backgroundColor: statusColor(agg),
                    border: isSelected ? '2px solid #4A90D9' : '1px solid rgba(255,255,255,0.55)',
                  }}
                />
              );
            })}
          </ZoomPan>
        </>
      )}

      {selectedString && (
            <div className="mt-4 rounded-xl border border-border bg-bg-panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-sm text-slate-100">{selectedString.n}</span>
                <span className="text-xs text-slate-400">
                  Tracker {selectedString.t ?? '-'} {selectedString.r ?? ''} · {selectedString.s}
                </span>
              </div>
              {selectedPanels.length === 0 ? (
                <p className="text-sm text-slate-500">No imported panels found at this location yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {selectedPanels.map((p) => (
                    <div
                      key={p.panelId}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-xs"
                    >
                      <span className="text-slate-400">#{p.locationId.split('.').pop()}</span>
                      <span className="font-mono text-slate-200">{p.serialNumber}</span>
                      <span className="text-slate-400">{p.status}</span>
                      <button onClick={() => copy(p.locationId)} className="text-accent-blue">
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
    </div>
  );
}
