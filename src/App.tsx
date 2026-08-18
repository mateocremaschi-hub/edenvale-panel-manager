import { HashRouter, Routes, Route } from 'react-router-dom';
import NavBar from '@/components/NavBar';
import StatusBar from '@/components/StatusBar';
import OperatorGate from '@/components/OperatorGate';
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
import DroneLocator from '@/pages/DroneLocator';
import BlockView from '@/pages/BlockView';
import { useAutoSync } from '@/hooks/useAutoSync';
import { useAppUpdate } from '@/hooks/useAppUpdate';

export default function App() {
  useAutoSync();
  const { needRefresh, applyUpdate } = useAppUpdate();
  return (
    <HashRouter>
      <ProjectGate>
      <OperatorGate>
        <div className="flex min-h-screen flex-col md:flex-row">
          <NavBar />
          <div className="flex-1 pb-16 md:pb-0">
            {needRefresh && (
              <button
                onClick={applyUpdate}
                className="flex w-full items-center justify-center gap-2 bg-accent-blue px-4 py-2 text-sm font-semibold text-white"
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
                <Route path="/locate" element={<DroneLocator />} />
              </Routes>
            </main>
          </div>
        </div>
      </OperatorGate>
      </ProjectGate>
    </HashRouter>
  );
}
