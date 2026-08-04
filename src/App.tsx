import { HashRouter, Routes, Route } from 'react-router-dom';
import NavBar from '@/components/NavBar';
import StatusBar from '@/components/StatusBar';
import OperatorGate from '@/components/OperatorGate';
import Dashboard from '@/pages/Dashboard';
import MapView from '@/pages/MapView';
import SearchPage from '@/pages/Search';
import Reports from '@/pages/Reports';
import Replacements from '@/pages/Replacements';
import Records from '@/pages/Records';
import Sync from '@/pages/Sync';
import Settings from '@/pages/Settings';
import Import from '@/pages/Import';
import BlockView from '@/pages/BlockView';

export default function App() {
  return (
    <HashRouter>
      <OperatorGate>
        <div className="flex min-h-screen flex-col md:flex-row">
          <NavBar />
          <div className="flex-1 pb-16 md:pb-0">
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
              </Routes>
            </main>
          </div>
        </div>
      </OperatorGate>
    </HashRouter>
  );
}
