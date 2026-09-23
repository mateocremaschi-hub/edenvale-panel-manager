import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PROJECTS, getProject, type ProjectConfig } from '@/lib/projects';

interface ProjectState {
  activeProjectId: string;
  /** False until someone explicitly picks a project on this device -- the app opens on the
   * project picker until then, instead of silently defaulting to the first farm. */
  chosen: boolean;
  setActiveProjectId: (id: string) => void;
}

export const useProject = create<ProjectState>()(
  persist(
    (set) => ({
      activeProjectId: PROJECTS[0].id,
      chosen: false,
      setActiveProjectId: (id) => set({ activeProjectId: id, chosen: true }),
    }),
    { name: 'panelmanager.activeProject' }
  )
);

export function activeProjectConfig(): ProjectConfig {
  return getProject(useProject.getState().activeProjectId);
}

/** Read without React, safe at module load (used by initData before the app renders). */
export function hasChosenProject(): boolean {
  try {
    const raw = localStorage.getItem('panelmanager.activeProject');
    return Boolean(raw && JSON.parse(raw)?.state?.chosen);
  } catch {
    return false;
  }
}
