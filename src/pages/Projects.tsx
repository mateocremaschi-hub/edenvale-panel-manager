import { PROJECTS, getProject, isProjectReady } from '@/lib/projects';
import { useProject } from '@/store/project';
import { useSettings } from '@/store/settings';

/** GRS runs several farms; this is where a user picks which one this device works on. Each
 * project has its own backend and its own local database, so switching is a full reload into a
 * completely separate dataset -- nothing from one farm ever mixes with another.
 *
 * Until real sign-in lands (stage 2), everyone sees every configured project. The intended
 * model: a technician is assigned exactly one project and lands in it directly; coordinators
 * and managers can open any of them. */
export default function Projects() {
  const { activeProjectId, setActiveProjectId } = useProject();

  function choose(id: string) {
    if (id === activeProjectId) {
      window.location.assign('/');
      return;
    }
    setActiveProjectId(id);
    // The display name is a per-device setting; make it follow the project.
    useSettings.getState().setAppName(`${getProject(id).name} Panel Manager`);
    // Full reload: the local database, the backend client and the geometry paths are all
    // resolved once at startup for the active project.
    window.location.assign('/');
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-accent-amber">GRS · Panel Manager</div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-slate-50">Choose a project</h1>
      <p className="mb-6 text-sm text-slate-400">
        Each solar farm is a separate project with its own panels, reports and replacements. This device works on one
        project at a time.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {PROJECTS.map((p) => {
          const ready = isProjectReady(p);
          const active = p.id === activeProjectId;
          return (
            <button
              key={p.id}
              onClick={() => ready && choose(p.id)}
              disabled={!ready}
              className={`card-premium flex flex-col items-start rounded-xl p-4 text-left transition ${
                active ? 'ring-2 ring-accent-blue' : ready ? 'hover:ring-1 hover:ring-accent-blue/50' : 'opacity-50'
              }`}
            >
              <div className="font-display text-lg font-bold text-slate-50">{p.name}</div>
              <div className="text-xs text-slate-400">
                {p.region ?? ''}
                {p.blockCount > 0 ? ` · ${p.blockCount} blocks` : ''}
              </div>
              <div className="mt-3 text-xs font-semibold">
                {active ? (
                  <span className="text-accent-blue">Current project</span>
                ) : ready ? (
                  <span className="text-slate-300">Open →</span>
                ) : (
                  <span className="text-slate-500">Not set up yet</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Adding a farm: its master panel Excel, the block interconnection drawings (for the maps) and a field check of the
        physical layout. Ask an admin.
      </p>
    </div>
  );
}
