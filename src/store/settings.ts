import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { activeProjectConfig } from './project';

interface SettingsState {
  appName: string;
  adminPin: string | null; // stores a SHA-256 hash (see lib/hash.ts), never the raw PIN
  voltageMin: number;
  voltageMax: number;
  setAppName: (name: string) => void;
  setAdminPin: (pin: string | null) => void;
  setVoltageRange: (min: number, max: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appName: `${activeProjectConfig().name} Panel Manager`,
      adminPin: null,
      voltageMin: 30,
      voltageMax: 55,
      setAppName: (name) => set({ appName: name }),
      setAdminPin: (pin) => set({ adminPin: pin }),
      setVoltageRange: (min, max) => set({ voltageMin: min, voltageMax: max }),
    }),
    { name: 'edenvale.panelmanager.settings' }
  )
);
