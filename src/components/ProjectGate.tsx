import type { ReactNode } from 'react';
import { PROJECTS } from '@/lib/projects';
import { useProject } from '@/store/project';
import Projects from '@/pages/Projects';

/** Opening the link on a device that hasn't picked a project yet lands on the project picker
 * -- never silently on the first farm. Once picked, the choice is remembered and the app opens
 * straight into that project (a technician picks their farm once); "Switch project" on the
 * Dashboard/Settings brings the picker back. With a single configured project it auto-picks. */
export default function ProjectGate({ children }: { children: ReactNode }) {
  const { chosen, setActiveProjectId } = useProject();

  if (chosen) return <>{children}</>;

  if (PROJECTS.length === 1) {
    setActiveProjectId(PROJECTS[0].id);
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-8">
      <div className="horizon-line mb-8" />
      <Projects />
    </div>
  );
}
