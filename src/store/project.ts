import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PROJECTS, getProject, type ProjectConfig } from '@/lib/projects';

interface ProjectState {
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
}

export const useProject = create<ProjectState>()(
  persist(
    (set) => ({
      activeProjectId: PROJECTS[0].id,
      setActiveProjectId: (id) => set({ activeProjectId: id }),
    }),
    { name: 'panelmanager.activeProject' }
  )
);

export function activeProjectConfig(): ProjectConfig {
  return getProject(useProject.getState().activeProjectId);
}
