import type { ReactNode } from 'react';
import { PROJECTS } from '@/lib/projects';
import { useProject } from '@/store/project';

/** Wraps the app in a project/farm picker -- but only actually shows one once there's more
 * than one project configured. With a single project (Edenvale today), this is a no-op:
 * it auto-selects that project and renders children immediately, so existing users see no
 * change at all. */
export default function ProjectGate({ children }: { children: ReactNode }) {
  const { activeProjectId, setActiveProjectId } = useProject();

  if (PROJECTS.length <= 1) {
    if (activeProjectId !== PROJECTS[0].id) setActiveProjectId(PROJECTS[0].id);
    return <>{children}</>;
  }

  const active = PROJECTS.find((p) => p.id === activeProjectId);
  if (active) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Which farm?</h1>
        <p className="mt-1 text-sm text-slate-400">Pick a project to continue</p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2">
        {PROJECTS.map((p) => (
          <button
            key={p.id}
            onClick={() => setActiveProjectId(p.id)}
            className="rounded-xl border border-border bg-bg-panel px-4 py-3 text-left text-base font-medium text-slate-100 active:bg-bg-raised"
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
