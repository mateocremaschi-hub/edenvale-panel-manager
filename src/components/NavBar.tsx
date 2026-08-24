import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Map, Search, FileWarning, Replace, Table2, RefreshCw, Settings, Crosshair } from 'lucide-react';
import { t } from '@/i18n';

const items = [
  { to: '/', label: t('nav_dashboard'), icon: LayoutDashboard },
  { to: '/map', label: t('nav_map'), icon: Map },
  { to: '/replacements', label: t('nav_replacements'), icon: Replace },
  { to: '/reports', label: t('nav_reports'), icon: FileWarning },
  { to: '/locate', label: 'Locate', icon: Crosshair },
  { to: '/records', label: t('nav_records'), icon: Table2 },
  { to: '/search', label: t('nav_search'), icon: Search },
  { to: '/sync', label: t('nav_sync'), icon: RefreshCw },
  { to: '/settings', label: t('nav_settings'), icon: Settings },
];

export default function NavBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex overflow-x-auto border-t border-border bg-bg-panel md:static md:h-screen md:w-56 md:flex-col md:gap-1 md:overflow-visible md:border-r md:border-t-0 md:p-2">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex min-w-[76px] flex-1 flex-col items-center justify-center gap-1 px-2 py-3 text-xs font-medium transition-colors md:flex-row md:flex-none md:justify-start md:gap-3 md:rounded-lg md:px-3 md:py-2.5 md:text-sm ${
              isActive ? 'text-accent-blue md:bg-accent-blue/10' : 'text-slate-400 hover:text-slate-200 md:hover:bg-white/5'
            }`
          }
        >
          <Icon size={22} strokeWidth={2} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
