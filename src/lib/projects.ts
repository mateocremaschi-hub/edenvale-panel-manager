/**
 * One entry per farm/project this app manages. Everything else in the codebase (UI, sync,
 * PDF generation, etc.) is farm-agnostic -- only this config + each project's own geometry
 * files and Supabase backend differ between projects. Adding a new farm later means: extract
 * its CAD geometry the same way Edenvale's was (see the skill notes), stand up its own
 * Supabase project (same SQL migrations), and add one entry here -- not rebuilding the app.
 *
 * Supabase URL/anon key are safe to keep here directly (not secret -- same as env vars, this
 * app's whole design already assumes the anon/publishable key is client-visible). Each
 * project keeps its own separate Supabase backend: Supabase's free tier caps at 2 projects
 * per account and ~500MB DB each, and a single farm's panel count alone can be a meaningful
 * fraction of that, so sharing one backend across farms doesn't scale.
 */
export interface ProjectConfig {
  id: string;
  name: string;
  blockCount: number;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Public/ path prefix where this project's per-block geometry JSON + images live. */
  geometryPath: string;
}

export const PROJECTS: ProjectConfig[] = [
  {
    id: 'edenvale',
    name: 'Edenvale Solar Farm',
    blockCount: 36,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    geometryPath: '/geometry',
  },
  // Next project goes here once its CAD geometry + Supabase backend are ready.
];

export function getProject(id: string): ProjectConfig {
  return PROJECTS.find((p) => p.id === id) ?? PROJECTS[0];
}
