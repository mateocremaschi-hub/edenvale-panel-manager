import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '@/lib/db';
import {
  loadBlockGeometry,
  blockImageUrl,
  computeTrackerBoxSizes,
  type BlockGeometry,
  type GeometryString,
} from '@/lib/geometry';
import { parseStringCode } from '@/lib/locationCode';
import type { Panel, PhysicalLocation } from '@/lib/types';
import ZoomPan from '@/components/ZoomPan';
import PanelStrip from '@/components/PanelStrip';

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
];

// A replaced panel is back to normal -- no color, so the map only draws attention to what
// still needs action (open issues, pending replacements), not to work already done.
function statusColor(agg: StringAgg | undefined): string {
  if (!agg || agg.total === 0) return LEGEND[0].color;
  if (agg.pending > 0) return LEGEND[2].color;
  if (agg.issue > 0) return LEGEND[1].color;
  return LEGEND[0].color;
}

function bump(map: Map<string, StringAgg>, key: string, status: Panel['status']) {
  const a = map.get(key) ?? { total: 0, issue: 0, pending: 0, replaced: 0 };
  a.total++;
  if (status === 'issue_reported' || status === 'under_assessment' || status === 'monitoring') a.issue++;
  if (status === 'pending_replacement' || status === 'vacant') a.pending++;
  if (status === 'replaced') a.replaced++;
  map.set(key, a);
}

export default function BlockView() {
  const { blockNum } = useParams<{ blockNum: string }>();
  const navigate = useNavigate();
  const block = Number(blockNum);
  const bpad = String(block).padStart(2, '0');

  const [viewMode, setViewMode] = useState<'schematic' | 'photo'>('schematic');
  const [geometry, setGeometry] = useState<BlockGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockLocations, setBlockLocations] = useState<PhysicalLocation[]>([]);
  const [blockPanels, setBlockPanels] = useState<Panel[]>([]);

  const [selectedTrackerNum, setSelectedTrackerNum] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<GeometryString[]>([]);

  useEffect(() => {
    if (!Number.isFinite(block)) return;
    setGeometry(null);
    setError(null);
    setSelectedTrackerNum(null);
    setSelectedRows([]);
    loadBlockGeometry(block)
      .then(setGeometry)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [block]);

  useEffect(() => {
    if (!Number.isFinite(block)) return;
    let cancelled = false;
    async function run() {
      const locs = await db.locations.where('block').equals(block).toArray();
      if (cancelled) return;
      setBlockLocations(locs);
      if (locs.length === 0) {
        setBlockPanels([]);
        return;
      }
      const panels = await db.panels.bulkGet(locs.map((l) => l.locationId));
      if (!cancelled) setBlockPanels(panels.filter((p): p is Panel => !!p));
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [block]);

  const locById = useMemo(() => new Map(blockLocations.map((l) => [l.locationId, l])), [blockLocations]);

  const statusByString = useMemo(() => {
    const byString = new Map<string, StringAgg>();
    for (const p of blockPanels) {
      const loc = locById.get(p.locationId);
      if (!loc) continue;
      bump(byString, loc.stringCode, p.status);
    }
    return byString;
  }, [blockPanels, locById]);

  // tracker number + row -> ALL GeometryStrings for that row (each row is actually 2
  // separate strings, not 1 -- confirmed against the real data).
  const stringsByTrackerRow = useMemo(() => {
    const map = new Map<string, GeometryString[]>();
    if (!geometry) return map;
    for (const s of geometry.strings) {
      if (s.t && s.r) {
        const key = `${s.t}-${s.r}`;
        const arr = map.get(key) ?? [];
        arr.push(s);
        map.set(key, arr);
      }
    }
    return map;
  }, [geometry]);

  function combinedAgg(strings: GeometryString[]): StringAgg | undefined {
    let acc: StringAgg | undefined;
    for (const s of strings) {
      const a = statusByString.get(s.n);
      if (!a) continue;
      acc = acc
        ? { total: acc.total + a.total, issue: acc.issue + a.issue, pending: acc.pending + a.pending, replaced: acc.replaced + a.replaced }
        : { ...a };
    }
    return acc;
  }

  const boxSizes = useMemo(
    () => (geometry ? computeTrackerBoxSizes(geometry) : new Map<string, { w: number; h: number }>()),
    [geometry]
  );

  const selectedTrackerInfo = selectedTrackerNum ? geometry?.trackers[`${bpad}-${selectedTrackerNum}`] : undefined;

  // Same isolated/last-in-chain rule as the drone locator's halfAndModule() -- see
  // dronePicas.ts for the full piercing-connector explanation. Computed once per tracker
  // (pos/pos_total don't vary between a tracker's own rows/strings).
  const farStringAscendsFromDcBox =
    selectedTrackerInfo?.pos == null ||
    selectedTrackerInfo?.pos_total == null ||
    selectedTrackerInfo.pos === selectedTrackerInfo.pos_total;

  /** Panels for a string, ordered to always walk DC-box-near -> DC-box-far left to right --
   * matching how a technician actually walks the row, instead of raw ascending module number
   * (which flips direction on the far string of a non-last tracker; see dronePicas.ts). */
  function panelsForString(s: GeometryString): { panels: Panel[]; nearEndLabel: string; farEndLabel: string } {
    const parts = parseStringCode(s.n);
    if (!parts || !geometry) return { panels: [], nearEndLabel: 'Near', farEndLabel: 'Far' };
    const prefix = `${parts.block}.${parts.inverter}.${parts.dcBox}.${parts.arrayBus}.${parts.string}.`;
    const ascending = blockPanels
      .filter((p) => p.locationId.startsWith(prefix))
      .sort((a, b) => Number(a.locationId.split('.').pop()) - Number(b.locationId.split('.').pop()));

    const rowPeerNums = geometry.strings
      .filter((gs) => gs.t === s.t && gs.r === s.r)
      .map((gs) => parseStringCode(gs.n)?.string)
      .filter((n): n is number => n != null);
    const isNearString = rowPeerNums.length < 2 || parts.string === Math.min(...rowPeerNums);
    const walksAscending = isNearString || farStringAscendsFromDcBox;

    return {
      panels: walksAscending ? ascending : [...ascending].reverse(),
      nearEndLabel: '⚡ Near DC box',
      farEndLabel: 'Far end',
    };
  }

  /** Selects the WHOLE tracker (all its rows/strings together) -- a double tracker with
   * R4+R5 is two separate 28-panel strings, and you want to see both without hunting for
   * the second one. */
  function openTrackerByNum(trackerNum: string) {
    if (!geometry) return;
    setSelectedTrackerNum(trackerNum);
    const rows = geometry.strings.filter((s) => s.t === trackerNum).sort((a, b) => (a.r ?? '').localeCompare(b.r ?? ''));
    setSelectedRows(rows);
  }

  if (!Number.isFinite(block)) {
    return <div className="text-sm text-status-pending">Invalid block number.</div>;
  }

  return (
    <div className="pb-20">
      <button onClick={() => navigate('/map')} className="mb-3 text-sm text-accent-blue">
        ← Back to map
      </button>
      <h1 className="mb-3 font-display text-xl font-bold tracking-tight text-slate-50">Block {block}</h1>

      {error && (
        <div className="rounded-lg bg-status-pending/20 p-3 text-sm text-status-pending">
          No plan geometry loaded for block {block} yet ({error}).
        </div>
      )}

      {!error && !geometry && <p className="text-sm text-slate-400">Loading real plan...</p>}

      {geometry && (
        <>
          <div className="mb-3 flex gap-2">
            <button
              onClick={() => setViewMode('schematic')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                viewMode === 'schematic' ? 'bg-accent-blue text-white' : 'bg-bg-panel text-slate-400'
              }`}
            >
              Schematic
            </button>
            <button
              onClick={() => setViewMode('photo')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                viewMode === 'photo' ? 'bg-accent-blue text-white' : 'bg-bg-panel text-slate-400'
              }`}
            >
              Real CAD plan
            </button>
          </div>

          <p className="mb-2 text-xs text-slate-500">
            {geometry.strings.length} strings · {Object.keys(geometry.trackers).length} trackers ·{' '}
            {geometry.dcbox.length} DC boxes. Pinch or scroll to zoom, drag to pan, tap a tracker row.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-3 w-3 rounded-sm border border-white/40" style={{ backgroundColor: l.color }} />
                {l.label}
              </span>
            ))}
            {viewMode === 'schematic' && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-3 w-3 rounded-full border border-white/40 bg-accent-amber" />
                DC box
              </span>
            )}
          </div>

          {viewMode === 'schematic' ? (
            <ZoomPan aspectRatio={geometry.w / geometry.h}>
              <svg viewBox={`0 0 ${geometry.w} ${geometry.h}`} className="absolute inset-0 h-full w-full" style={{ background: '#07080d' }}>
                {geometry.axis === 'x' ? (
                  <rect x={geometry.road - geometry.w / 220} y={0} width={Math.max(2, geometry.w / 110)} height={geometry.h} fill="#182236" />
                ) : (
                  <rect x={0} y={geometry.road - geometry.h / 220} width={geometry.w} height={Math.max(2, geometry.h / 110)} fill="#182236" />
                )}
                {Object.entries(geometry.trackers).map(([key, t]) => {
                  const trackerNum = key.split('-')[1];
                  const rows = [...t.rows].sort();
                  const box = boxSizes.get(key) ?? { w: 10, h: 10 };
                  const stripH = box.h / Math.max(1, rows.length);
                  const labelFont = Math.max(6, Math.min(box.w, box.h) * 0.55);
                  const isSelectedTracker = selectedTrackerNum === trackerNum;
                  return (
                    <g key={key}>
                      {rows.map((row, i) => {
                        const strs = stringsByTrackerRow.get(`${trackerNum}-${row}`) ?? [];
                        const agg = combinedAgg(strs);
                        const y = t.cy - box.h / 2 + i * stripH;
                        return (
                          <rect
                            key={row}
                            x={t.cx - box.w / 2}
                            y={y}
                            width={box.w}
                            height={stripH}
                            rx={Math.min(box.w, stripH) * 0.12}
                            fill={statusColor(agg)}
                            stroke={isSelectedTracker ? '#4A90D9' : 'rgba(255,255,255,0.35)'}
                            strokeWidth={isSelectedTracker ? 2.5 : 1}
                            onClick={() => openTrackerByNum(trackerNum)}
                            style={{ cursor: 'pointer' }}
                          />
                        );
                      })}
                      <text
                        x={t.cx}
                        y={t.cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={labelFont}
                        fontWeight={700}
                        fill="#ffffff"
                        stroke="#07080d"
                        strokeWidth={labelFont * 0.12}
                        paintOrder="stroke"
                        style={{ pointerEvents: 'none' }}
                      >
                        {trackerNum}
                      </text>
                    </g>
                  );
                })}
                {geometry.dcbox.map((d) => (
                  <circle
                    key={d.name}
                    cx={d.x}
                    cy={d.y}
                    r={Math.max(2, Math.min(geometry.w, geometry.h) / 220)}
                    fill="#F1C232"
                    stroke="#07080d"
                    strokeWidth={1}
                    style={{ pointerEvents: 'none' }}
                  />
                ))}
              </svg>
            </ZoomPan>
          ) : (
            <ZoomPan aspectRatio={geometry.w / geometry.h}>
              <img src={blockImageUrl(block)} alt={`Block ${block} plan`} className="absolute inset-0 h-full w-full" draggable={false} />
              {geometry.strings.map((s) => {
                const agg = statusByString.get(s.n);
                const left = ((s.x - s.w / 2) / geometry.w) * 100;
                const top = ((s.y - s.h / 2) / geometry.h) * 100;
                const width = (s.w / geometry.w) * 100;
                const height = (s.h / geometry.h) * 100;
                const isSelected = !!s.t && selectedTrackerNum === s.t;
                return (
                  <button
                    key={s.n}
                    onClick={() => s.t && openTrackerByNum(s.t)}
                    title={s.n}
                    className="absolute rounded-[1px]"
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
          )}
        </>
      )}

      {selectedTrackerNum && (
        <div className="mt-4 rounded-xl border border-border bg-bg-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-sm text-slate-100">Tracker {bpad}-{selectedTrackerNum}</span>
            <span className="text-xs text-slate-400">
              {selectedTrackerInfo?.side ?? '-'} · pos {selectedTrackerInfo?.pos ?? '-'}/{selectedTrackerInfo?.pos_total ?? '-'} from road
              · DC box {selectedTrackerInfo?.dcbox ?? '-'}
            </span>
          </div>
          <div className="flex flex-col gap-4">
            {selectedRows.length === 0 && <p className="text-sm text-slate-500">No strings mapped to this tracker.</p>}
            {selectedRows.map((s) => {
              const { panels, nearEndLabel, farEndLabel } = panelsForString(s);
              return (
                <PanelStrip
                  key={s.n}
                  title={`${s.r ?? ''} · ${s.n}`}
                  panels={panels}
                  nearEndLabel={nearEndLabel}
                  farEndLabel={farEndLabel}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
