import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { activeProjectConfig } from '@/store/project';

// Cached per project id -- switching the active project (once more than one exists) picks up
// a fresh client pointed at that project's own Supabase backend instead of reusing a stale one.
let cachedClient: SupabaseClient | null | undefined;
let cachedForProjectId: string | undefined;

export function hasSupabase(): boolean {
  const project = activeProjectConfig();
  return Boolean(project.supabaseUrl && project.supabaseAnonKey);
}

/** Returns null if Supabase isn't configured for the active project -- callers should fall
 * back to local-only behaviour rather than throwing, since the app must keep working offline
 * and for anyone who hasn't set up a backend for their project yet. */
export function getSupabase(): SupabaseClient | null {
  const project = activeProjectConfig();
  if (cachedClient !== undefined && cachedForProjectId === project.id) return cachedClient;
  cachedClient = project.supabaseUrl && project.supabaseAnonKey ? createClient(project.supabaseUrl, project.supabaseAnonKey) : null;
  cachedForProjectId = project.id;
  return cachedClient;
}
