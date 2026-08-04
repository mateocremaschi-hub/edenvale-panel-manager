import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '@/lib/db';
import {
  loadBlockGeometry,
  blockImageUrl,
  computeTrackerBoxSize,
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
  { label: 'Replaced', color: 'rgba(92,184,92,0.7)' },
];

function statusColor(agg: StringAgg | undefined): string {
  if (!agg || agg.total === 0) return LEGEND[0].color;
  if (agg.pending > 0) return LEGEND[2].color;
  if (agg.issue > 0) return LEGEND[1].color;
  if (agg.replaced === agg.total) return LEGEND[3].color;
  return LEGEND[0].color;
}

function bump(map: Map<string, StringAgg>, key: string, status: Panel['status']) {
  const a = map.get(key) ?? { total: 0, issue: 0, pending: 0, replaced: 0 };
  a.total++;
  if (status === 'issue_reported' || status === 'under_assessment' || status === 'monitoring') a.issue++;
  if (status === 'pending_replacement') a.pending++;
  if (status === 'replaced') a.replaced++;
  map.set(key, a);
}

export default function BlockView() {
  const { blockNum } = useParams<{ blockNum: string }>();
  const navigate = useNavigate();
  const block = Number(blockNum);

  const [viewMode, setViewMode] = useState<'schematic' | 'photo'>('schematic');
  const [geometry, setGeometry] = useState<BlockGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockLocations, setBlockLocations] = useState<PhysicalLocation[]>([]);
  const [blockPanels, setBlockPanels] = useState<Panel[]>([]);

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

  // tracker number + row -> the GeometryString for that specific row, so each row-strip
  // can be tapped straight through to its own string (not the whole tracker).
  const stringByTrackerRow = useMemo(() => {
    const map = new Map<string, GeometryString>();
    if (!geometry) return map;
    for (const s of geometry.strings) {
      if (s.t && s.r) map.set(`${s.t}-${s.r}`, s);
    }
    return map;
  }, [geometry]);

  const boxSize = useMemo(() => (geometry ? computeTrackerBoxSize(geometry) : { w: 20, h: 20 }), [geometry]);

  function panelsForStringCode(code: string): Panel[] {
    const parts = parseStringCode(code);
    if (!parts) return [];
    const prefix = `${parts.block}.${parts.inverter}.${parts.dcBox}.${parts.arrayBus}.${parts.string}.`;
    return blockPanels
      .filter((p) => p.locationId.startsWith(prefix))
      .sort((a, b) => Number(a.locationId.split('.').pop()) - Number(b.locationId.split('.').pop()));
  }

  function openString(s: GeometryString) {
    setSelectedString(s);
    setSelectedPanels(panelsForStringCode(s.n));
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
            {geometry.dcbox.length} DC boxes. Pinch or scroll to zoom, drag to pan, tap a string.
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
              <svg viewBox={`0 0 ${geometry.w} ${geometry.h}`} className="absolute inset-0 h-full w-full" style={{ background: '#0b1220' }}>
                {geometry.axis === 'x' ? (
                  <rect x={geometry.road - boxSize.w * 0.3} y={0} width={Math.max(2, boxSize.w * 0.6)} height={geometry.h} fill="#182236" />
                ) : (
                  <rect x={0} y={geometry.road - boxSize.h * 0.3} width={geometry.w} height={Math.max(2, boxSize.h * 0.6)} fill="#182236" />
                )}
                {Object.entries(geometry.trackers).map(([key, t]) => {
                  const trackerNum = key.split('-')[1];
                  const rows = [...t.rows].sort();
                  const stripH = boxSize.h / Math.max(1, rows.length);
                  const labelFont = Math.max(5, Math.min(boxSize.w, boxSize.h) * 0.32);
                  const rowFont = Math.max(4.5, Math.min(boxSize.w * 0.18, stripH * 0.62));
                  return (
                    <g key={key}>
                      <text
                        x={t.cx}
                        y={t.cy - boxSize.h / 2 - labelFont * 0.35}
                        textAnchor="middle"
                        fontSize={labelFont}
                        fill="rgba(226,232,240,0.75)"
                        style={{ pointerEvents: 'none' }}
                      >
                        {trackerNum}
                      </text>
                      {rows.map((row, i) => {
                        const s = stringByTrackerRow.get(`${trackerNum}-${row}`);
                        const agg = s ? statusByString.get(s.n) : undefined;
                        const isSelected = !!s && selectedString?.n === s.n;
                        const y = t.cy - boxSize.h / 2 + i * stripH;
                        return (
                          <rect
                            key={row}
                            x={t.cx - boxSize.w / 2}
                            y={y}
                            width={boxSize.w}
                            height={stripH}
                            rx={Math.min(boxSize.w, stripH) * 0.12}
                            fill={statusColor(agg)}
                            stroke={isSelected ? '#4A90D9' : 'rgba(255,255,255,0.35)'}
                            strokeWidth={isSelected ? 2.5 : 1}
                            onClick={() => s && openString(s)}
                            style={{ cursor: s ? 'pointer' : 'default' }}
                          />
                        );
                      })}
                      {rows.map((row, i) => {
                        const y = t.cy - boxSize.h / 2 + i * stripH + stripH / 2;
                        return (
                          <text
                            key={row + '-label'}
                            x={t.cx}
                            y={y}
                            textAnchor="middle"
                            dominantBaseline="central"
                            fontSize={rowFont}
                            fontWeight={600}
                            fill="rgba(11,18,32,0.8)"
                            style={{ pointerEvents: 'none' }}
                          >
                            {row}
                          </text>
                        );
                      })}
                    </g>
                  );
                })}
                {geometry.dcbox.map((d) => (
                  <circle
                    key={d.name}
                    cx={d.x}
                    cy={d.y}
                    r={Math.max(2, Math.min(boxSize.w, boxSize.h) * 0.16)}
                    fill="#F1C232"
                    stroke="#0b1220"
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
                const isSelected = selectedString?.n === s.n;
                return (
                  <button
                    key={s.n}
                    onClick={() => openString(s)}
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

      {selectedString && (
        <div className="mt-4 rounded-xl border border-border bg-bg-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-sm text-slate-100">{selectedString.n}</span>
            <span className="text-xs text-slate-400">
              Tracker {selectedString.t ?? '-'} {selectedString.r ?? ''} · {selectedString.s}
            </span>
          </div>
          <PanelStrip panels={selectedPanels} />
        </div>
      )}
    </div>
  );
}
