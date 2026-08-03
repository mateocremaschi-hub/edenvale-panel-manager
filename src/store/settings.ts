import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  appName: string;
  adminPin: string | null; // TODO(Etapa 7): hash before this leaves local dev
  voltageMin: number;
  voltageMax: number;
  setAppName: (name: string) => void;
  setAdminPin: (pin: string | null) => void;
  setVoltageRange: (min: number, max: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      appName: 'Edenvale Panel Manager',
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
