import { HashRouter, Routes, Route } from 'react-router-dom';
import NavBar from '@/components/NavBar';
import StatusBar from '@/components/StatusBar';
import AuthGate from '@/components/AuthGate';
import ProjectGate from '@/components/ProjectGate';
import Dashboard from '@/pages/Dashboard';
import MapView from '@/pages/MapView';
import SearchPage from '@/pages/Search';
import Reports from '@/pages/Reports';
import Replacements from '@/pages/Replacements';
import Records from '@/pages/Records';
import Sync from '@/pages/Sync';
import Settings from '@/pages/Settings';
import Import from '@/pages/Import';
import RestoreMaster from '@/pages/RestoreMaster';
import ImportHistory from '@/pages/ImportHistory';
import DroneLocator from '@/pages/DroneLocator';
import Projects from '@/pages/Projects';
import BlockView from '@/pages/BlockView';
import { useAutoSync } from '@/hooks/useAutoSync';
import { usePanelsRealtime } from '@/hooks/usePanelsRealtime';
import { useAppUpdate } from '@/hooks/useAppUpdate';

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
            </main>
          </div>
        </div>
      </AuthGate>
      </ProjectGate>
    </HashRouter>
  );
}
