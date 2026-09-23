import { HashRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import NavBar from '@/components/NavBar';
import StatusBar from '@/components/StatusBar';
import AuthGate from '@/components/AuthGate';
import ProjectGate from '@/components/ProjectGate';
import Dashboard from '@/pages/Dashboard';
import { useAutoSync } from '@/hooks/useAutoSync';
import { usePanelsRealtime } from '@/hooks/usePanelsRealtime';
import { useAppUpdate } from '@/hooks/useAppUpdate';

// Lazy-loaded: every page except Dashboard (the first thing shown right after sign-in, so it
// stays in the main bundle to avoid an extra loading flash there). Splitting the rest into
// their own chunks means a technician who only ever uses Dashboard/Map/Replacements never
// downloads the code for Import, Restore, drone-locator maths, PDF export, etc. on first load
// -- meaningfully smaller and faster on a phone. Each page's own chunk still only loads once,
// the first time that route is visited.
const MapView = lazy(() => import('@/pages/MapView'));
const BlockView = lazy(() => import('@/pages/BlockView'));
const SearchPage = lazy(() => import('@/pages/Search'));
const Reports = lazy(() => import('@/pages/Reports'));
const Replacements = lazy(() => import('@/pages/Replacements'));
const Records = lazy(() => import('@/pages/Records'));
const Sync = lazy(() => import('@/pages/Sync'));
const Settings = lazy(() => import('@/pages/Settings'));
const Import = lazy(() => import('@/pages/Import'));
const RestoreMaster = lazy(() => import('@/pages/RestoreMaster'));
const ImportHistory = lazy(() => import('@/pages/ImportHistory'));
const DroneLocator = lazy(() => import('@/pages/DroneLocator'));
const Projects = lazy(() => import('@/pages/Projects'));

/** Sync + Realtime only make sense once someone is signed in (the tables are only readable by
 * signed-in users), so they mount inside the gates rather than at the app root. */
function SyncHooks() {
  useAutoSync();
  usePanelsRealtime();
  return null;
}

export default function App() {
  const { needRefresh, applyUpdate } = useAppUpdate();
  return (
    <HashRouter>
      <ProjectGate>
      <AuthGate>
        <SyncHooks />
        <div className="flex min-h-screen flex-col md:flex-row">
          <NavBar />
          <div className="flex-1 pb-16 md:pb-0">
            <div className="horizon-line" />
            {needRefresh && (
              <button
                onClick={applyUpdate}
                className="flex w-full items-center justify-center gap-2 btn-primary px-4 py-2 text-sm font-semibold text-white"
              >
                🔄 New version available -- tap to update
              </button>
            )}
            <StatusBar />
            <main className="p-4">
              <Suspense fallback={<div className="py-10 text-center text-sm text-slate-500">Loading...</div>}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/map" element={<MapView />} />
                <Route path="/map/block/:blockNum" element={<BlockView />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/replacements" element={<Replacements />} />
                <Route path="/records" element={<Records />} />
                <Route path="/sync" element={<Sync />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/import" element={<Import />} />
                <Route path="/restore-master" element={<RestoreMaster />} />
                <Route path="/import-history" element={<ImportHistory />} />
                <Route path="/locate" element={<DroneLocator />} />
                <Route path="/projects" element={<Projects />} />
              </Routes>
              </Suspense>
            </main>
          </div>
        </div>
      </AuthGate>
      </ProjectGate>
    </HashRouter>
  );
}
