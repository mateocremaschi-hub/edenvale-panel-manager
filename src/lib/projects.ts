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
/** Physical layout facts the drone locator and the schematic strip depend on. Every one of
 * these was field-measured at Edenvale and must be re-verified (not assumed) for a new farm --
 * the piercing-connector and motor-bay lessons both came from assuming. */
export interface ProjectLayout {
  modulesPerString: number; // 28 at Edenvale
  panelM: number; // module width along the row, metres
  gapM: number; // gap between modules
  motorBayM: number; // gap between a row's two strings where the tracker motor sits
  overhangM: number; // how far the panels extend past each survey pica
  wattClasses: number[]; // nominal classes installed, e.g. [535, 540, 545]
}

export interface ProjectConfig {
  id: string;
  name: string;
  region?: string;
  blockCount: number;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** Public/ path prefix where this project's per-block geometry JSON + images live. */
  geometryPath: string;
  layout: ProjectLayout;
}

export const EDENVALE_LAYOUT: ProjectLayout = {
  modulesPerString: 28,
  panelM: 1.13,
  gapM: 0.02,
  motorBayM: 3.713,
  overhangM: 1.464,
  wattClasses: [535, 540, 545],
};

export const PROJECTS: ProjectConfig[] = [
  {
    id: 'edenvale',
    name: 'Edenvale Solar Farm',
    region: 'Queensland',
    blockCount: 36,
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    geometryPath: '/geometry',
    layout: EDENVALE_LAYOUT,
  },
  // GRS's other farms -- placeholders until each has its master Excel, CAD geometry and its
  // own Supabase backend. Without supabaseUrl a project shows as "not set up yet" and can't be
  // opened. blockCount 0 = unknown yet. Layout is a copy of Edenvale's ONLY as a starting
  // point -- it must be re-measured on site before the drone locator is trusted there.
  { id: 'wandoan-2', name: 'Wandoan 2', region: 'Queensland', blockCount: 0, geometryPath: '/geometry/wandoan-2', layout: EDENVALE_LAYOUT },
  // Wellington: geometry for all 52 blocks extracted (Sept 2026) from the civil drawings
  // (WEN-ISE-CV-DRW-0007 series) + the string list (WEN-ISE-EL-SCH-0006) -- 6,803 trackers,
  // 26,792 strings, 40 DC boxes per block, every tracker cross-checked against both sources.
  // Layout is still Edenvale's as a placeholder: ~4 trackers per block are SHORT (1 string per
  // row, half-length bar; label code 'S'), which the drone locator's 2-strings-per-row model
  // does not handle yet. modulesPerString=28 is the working assumption until the master
  // panel Excel confirms it. Still needs its own Supabase project (supabaseUrl/anonKey).
  { id: 'wellington', name: 'Wellington', region: 'New South Wales', blockCount: 52, geometryPath: '/geometry/wellington', layout: EDENVALE_LAYOUT },
  { id: 'walla-walla', name: 'Walla Walla', region: 'New South Wales', blockCount: 0, geometryPath: '/geometry/walla-walla', layout: EDENVALE_LAYOUT },
  { id: 'carwarp', name: 'Carwarp', region: 'Victoria', blockCount: 0, geometryPath: '/geometry/carwarp', layout: EDENVALE_LAYOUT },
];

/** Projects a user can open. Until real auth lands (stage 2), everyone sees every configured
 * project; a technician is meant to be assigned one, coordinators/managers all of them. */
export function isProjectReady(p: ProjectConfig): boolean {
  return Boolean(p.supabaseUrl && p.supabaseAnonKey);
}

export function getProject(id: string): ProjectConfig {
  return PROJECTS.find((p) => p.id === id) ?? PROJECTS[0];
}
