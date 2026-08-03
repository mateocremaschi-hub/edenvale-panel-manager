import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

export default function MapView() {
  const locations = useLiveQuery(() => db.locations.toArray(), [], []);
  const panels = useLiveQuery(() => db.panels.toArray(), [], []);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);

  const blocks = useMemo(() => {
    const set = new Set((locations ?? []).map((l) => l.block));
    return Array.from(set).sort((a, b) => a - b);
  }, [locations]);

  const panelsByLocation = useMemo(() => new Map((panels ?? []).map((p) => [p.locationId, p])), [panels]);

  function blockStats(block: number) {
    const locs = (locations ?? []).filter((l) => l.block === block);
    let issue = 0;
    let pending = 0;
    let replaced = 0;
    for (const l of locs) {
      const p = panelsByLocation.get(l.locationId);
      if (!p) continue;
      if (p.status === 'issue_reported' || p.status === 'under_assessment' || p.status === 'monitoring') issue++;
      if (p.status === 'pending_replacement') pending++;
      if (p.status === 'replaced') replaced++;
    }
    return { total: locs.length, issue, pending, replaced };
  }

  function blockColor(stats: ReturnType<typeof blockStats>) {
    if (stats.pending > 0) return 'bg-status-pending';
    if (stats.issue > 0) return 'bg-status-reported';
    if (stats.replaced > 0) return 'bg-status-replaced';
    return 'bg-status-normal';
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-100">Map</h1>
      <p className="mb-4 text-sm text-slate-500">
        Farm overview only (Etapa 0). The hierarchical block → tracker → panel map with real vector
        geometry (reusing the Vegetation Control layout_geojson approach) lands in Etapa 2, once the
        layout files are attached.
      </p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
        {blocks.map((b) => {
          const stats = blockStats(b);
          return (
            <button
              key={b}
              onClick={() => setSelectedBlock(b)}
              className={`aspect-square rounded-lg font-semibold text-bg-panel ${blockColor(stats)} ${
                selectedBlock === b ? 'ring-2 ring-status-selected' : ''
              }`}
            >
              <span className="text-sm">{b}</span>
            </button>
          );
        })}
      </div>
      {selectedBlock !== null &&
        (() => {
          const stats = blockStats(selectedBlock);
          return (
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-border bg-bg-panel p-4 text-sm sm:grid-cols-4">
              <div>Block {selectedBlock}</div>
              <div>{stats.total} panels</div>
              <div>{stats.issue} with issues</div>
              <div>{stats.pending} pending replacement</div>
            </div>
          );
        })()}
    </div>
  );
}
