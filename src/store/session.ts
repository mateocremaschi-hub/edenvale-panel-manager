import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Role } from '@/lib/auth';

/** operatorId is now the signed-in user's auth id (kept under the old name so every existing
 * "who did this" field and display keeps working unchanged). role gates admin-only tools. */
interface SessionState {
  operatorId: string | null;
  operatorName: string | null;
  role: Role | null;
  setOperator: (id: string, name: string, role?: Role) => void;
  clearOperator: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      operatorId: null,
      operatorName: null,
      role: null,
      setOperator: (id, name, role) => set({ operatorId: id, operatorName: name, role: role ?? null }),
      clearOperator: () => set({ operatorId: null, operatorName: null, role: null }),
    }),
    { name: 'edenvale.panelmanager.session' }
  )
);
