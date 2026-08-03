import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { PanelStatus } from '@/lib/types';

const TABS: { key: PanelStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All panels' },
  { key: 'issue_reported', label: 'Open issues' },
  { key: 'pending_replacement', label: 'Pending replacement' },
  { key: 'replaced', label: 'Replaced' },
  { key: 'closed', label: 'Closed' },
];

export default function Records() {
  const panels = useLiveQuery(() => db.panels.toArray(), [], []);
  const [tab, setTab] = useState<PanelStatus | 'all'>('all');
  const [blockFilter, setBlockFilter] = useState('');
  const [q, setQ] = useState('');

  const blocks = useMemo(() => {
    const set = new Set((panels ?? []).map((p) => p.locationId.split('.')[0]));
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [panels]);

  const filtered = useMemo(() => {
    return (panels ?? []).filter((p) => {
      if (tab !== 'all' && p.status !== tab) return false;
      if (blockFilter && p.locationId.split('.')[0] !== blockFilter) return false;
      if (q && !p.serialNumber.includes(q) && !p.locationId.includes(q)) return false;
      return true;
    });
  }, [panels, tab, blockFilter, q]);

  function exportCsv() {
    const header = 'locationId,serialNumber,status,voltage\n';
    const rows = filtered.map((p) => `${p.locationId},${p.serialNumber},${p.status},${p.voltage ?? ''}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'panel-manager-records.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-100">Records</h1>
      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              tab === tb.key ? 'bg-accent-blue text-white' : 'bg-bg-panel text-slate-400'
            }`}
          >
            {tb.label}
          </button>
        ))}
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
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by serial / location"
          className="flex-1 rounded-lg border border-border bg-bg-panel px-3 py-2 text-sm text-slate-100"
        />
        <button onClick={exportCsv} className="rounded-lg border border-border px-3 py-2 text-sm text-slate-300">
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-xs uppercase text-slate-400">
            <tr>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Serial</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Voltage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((p) => (
              <tr key={p.panelId} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{p.locationId}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.serialNumber}</td>
                <td className="px-3 py-2">{p.status}</td>
                <td className="px-3 py-2">{p.voltage?.toFixed(2) ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 200 && (
        <p className="mt-2 text-xs text-slate-500">
          Showing first 200 of {filtered.length} matches. Column show/hide, saved filters, and a virtualized
          table for the real ~378k rows ship in Etapa 6.
        </p>
      )}
    </div>
  );
}
