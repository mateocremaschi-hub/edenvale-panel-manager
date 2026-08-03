import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionState {
  operatorId: string | null;
  operatorName: string | null;
  setOperator: (id: string, name: string) => void;
  clearOperator: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      operatorId: null,
      operatorName: null,
      setOperator: (id, name) => set({ operatorId: id, operatorName: name }),
      clearOperator: () => set({ operatorId: null, operatorName: null }),
    }),
    { name: 'edenvale.panelmanager.session' }
  )
);
