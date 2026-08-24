import { useState } from 'react';
import { db } from '@/lib/db';
import { compareLocationIds } from '@/lib/locationCode';
import { displaySerial } from '@/lib/panelDisplay';
import type { Panel } from '@/lib/types';
import { t } from '@/i18n';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Panel[]>([]);
  const [loading, setLoading] = useState(false);

  async function runSearch(q: string) {
    setQuery(q);
    const term = q.trim().toLowerCase();
    if (!term) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      // Etapa 0: linear scan over the (small) fictional dataset. Etapa 1 adds compound
      // indexes / a dedicated search index for the real ~378k-row dataset (see README
      // "Rendimiento") so this stays fast at full scale.
      const [panels, replacements, issues] = await Promise.all([
        db.panels.toArray(),
        db.replacements.toArray(),
        db.issues.toArray(),
      ]);
      const oldSerialMatches = new Set(
        replacements.filter((r) => r.removedSerial.toLowerCase().includes(term)).map((r) => r.locationId)
      );
      const sunManagerMatches = new Set(
        issues.filter((i) => i.sunManagerId?.toLowerCase().includes(term)).map((i) => i.locationId)
      );
      const filtered = panels.filter(
        (p) =>
          p.serialNumber.toLowerCase().includes(term) ||
          p.serialNumberShort?.toLowerCase().includes(term) ||
          p.locationId.toLowerCase().includes(term) ||
          p.status.toLowerCase().includes(term) ||
          oldSerialMatches.has(p.locationId) ||
          sunManagerMatches.has(p.locationId)
      );
      setResults(filtered.sort((a, b) => compareLocationIds(a.locationId, b.locationId)).slice(0, 50));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 font-display text-xl font-bold tracking-tight text-slate-50">{t('nav_search')}</h1>
      <input
        autoFocus
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        placeholder="Serial number, location, block, SunManager ID..."
        className="w-full rounded-xl border border-border bg-bg-panel px-4 py-3 text-base text-slate-100 placeholder:text-slate-500"
      />
      {loading && <p className="mt-3 text-sm text-slate-500">Searching...</p>}
      <div className="mt-4 flex flex-col gap-2">
        {results.map((p) => (
          <div key={p.panelId} className="rounded-xl border border-border bg-bg-panel p-3">
            <div className="font-mono text-sm text-slate-100">{displaySerial(p.serialNumber)}</div>
            <div className="text-xs text-slate-400">
              Block {p.locationId.split('.')[0]} · {p.locationId} · {p.status}
            </div>
          </div>
        ))}
        {!loading && query && results.length === 0 && <p className="text-sm text-slate-500">No matches.</p>}
      </div>
    </div>
  );
}
