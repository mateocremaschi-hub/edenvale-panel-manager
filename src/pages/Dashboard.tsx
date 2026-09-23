import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { t } from '@/i18n';
import { useSettings } from '@/store/settings';
import SyncNowCard from '@/components/SyncNowCard';
import { Link } from 'react-router-dom';
import { activeProjectConfig } from '@/store/project';

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
  const project = activeProjectConfig();

  const totalPanels = useLiveQuery(() => db.panels.count(), [], 0);
  const openIssues = useLiveQuery(() => db.issues.where('status').equals('open').count(), [], 0);
  const pendingReplacement = useLiveQuery(
    () => db.panels.where('status').equals('pending_replacement').count(),
    [],
    0
  );
  const noSunManager = useLiveQuery(() => db.replacements.filter((r) => !r.smUploaded).count(), [], 0);
  const replacements = useLiveQuery(() => db.replacements.toArray(), [], []);
  const dataSourceEntry = useLiveQuery(() => db.meta.get('dataSource'), [], undefined);
  const dataSource = dataSourceEntry?.value ?? 'empty';

  const yearStart = startOf('year').getTime();
  const countSince = (since: number) =>
    (replacements ?? []).filter((r) => new Date(r.replacementDate).getTime() >= since).length;

  const cards = [
    { label: t('dashboard_total_panels'), value: totalPanels },
    { label: t('dashboard_open_issues'), value: openIssues },
    { label: t('dashboard_pending_replacement'), value: pendingReplacement },
    { label: t('dashboard_replaced_year'), value: countSince(yearStart) },
    { label: t('dashboard_no_sunmanager'), value: noSunManager },
  ];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-accent-amber">GRS · {project.name}{project.region ? ` · ${project.region}` : ''}</span>
        <Link to="/projects" className="text-[11px] font-semibold text-slate-400 underline hover:text-slate-200">
          Switch project
        </Link>
      </div>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-50">{appName}</h1>
      <p className="mb-5 mt-1 text-sm text-slate-400">
        {totalPanels ? `${totalPanels.toLocaleString()} panels under active management` : 'Loading panel data...'}
      </p>
      <SyncNowCard />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card-premium p-4">
            <div className="font-display text-2xl font-bold tracking-tight text-slate-50">{c.value}</div>
            <div className="mt-1 text-xs font-medium text-slate-400">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-slate-500">
        {dataSource === 'fictional' &&
          'Running on fictional test data (Etapa 0) -- import the real Excel from Settings → Data import.'}
        {dataSource === 'empty' &&
          totalPanels === 0 &&
          'No data loaded on this device/URL yet. Fictional test data will seed automatically, or import the real Excel from Settings.'}
      </p>
    </div>
  );
}
