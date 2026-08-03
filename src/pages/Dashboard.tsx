import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { t } from '@/i18n';
import { useSettings } from '@/store/settings';

function startOf(period: 'week' | 'month' | 'year'): Date {
  const d = new Date();
  if (period === 'week') {
    const day = d.getDay();
    const diff = (day + 6) % 7; // Monday as start of week
    d.setDate(d.getDate() - diff);
  } else if (period === 'month') {
    d.setDate(1);
  } else {
    d.setMonth(0, 1);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Dashboard() {
  const appName = useSettings((s) => s.appName);

  const totalPanels = useLiveQuery(() => db.panels.count(), [], 0);
  const openIssues = useLiveQuery(() => db.issues.where('status').equals('open').count(), [], 0);
  const pendingReplacement = useLiveQuery(
    () => db.panels.where('status').equals('pending_replacement').count(),
    [],
    0
  );
  const noSunManager = useLiveQuery(() => db.issues.filter((i) => !i.sunManagerId).count(), [], 0);
  const replacements = useLiveQuery(() => db.replacements.toArray(), [], []);

  const weekStart = startOf('week').getTime();
  const monthStart = startOf('month').getTime();
  const yearStart = startOf('year').getTime();
  const countSince = (since: number) =>
    (replacements ?? []).filter((r) => new Date(r.replacementDate).getTime() >= since).length;

  const cards = [
    { label: t('dashboard_total_panels'), value: totalPanels },
    { label: t('dashboard_open_issues'), value: openIssues },
    { label: t('dashboard_pending_replacement'), value: pendingReplacement },
    { label: t('dashboard_replaced_week'), value: countSince(weekStart) },
    { label: t('dashboard_replaced_month'), value: countSince(monthStart) },
    { label: t('dashboard_replaced_year'), value: countSince(yearStart) },
    { label: t('dashboard_no_sunmanager'), value: noSunManager },
  ];

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-100">{appName}</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-bg-panel p-4">
            <div className="text-2xl font-bold text-slate-100">{c.value}</div>
            <div className="mt-1 text-xs text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-slate-500">
        Running on fictional test data (Etapa 0). The real Excel importer ships in Etapa 1.
      </p>
    </div>
  );
}
