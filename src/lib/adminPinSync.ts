import { getSupabase } from './supabase';

const KEY = 'admin_pin_hash';

/** Uploads the current admin PIN hash (or null, to clear it) to the shared server, so every
 * device -- not just the one where it was set -- ends up protected. Never sends a raw PIN,
 * only the SHA-256 hash (see lib/hash.ts) that was already computed before this is called. */
export async function pushAdminPinHash(hash: string | null): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('app_config').upsert({ key: KEY, value: hash, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Uploading admin PIN failed: ${error.message}`);
}

/** Downloads the shared admin PIN hash. Returns undefined if the row doesn't exist yet (nobody
 * has ever set a shared PIN) so the caller can tell that apart from an explicit "no PIN" (null). */
export async function pullAdminPinHash(): Promise<string | null | undefined> {
  const supabase = getSupabase();
  if (!supabase) return undefined;
  const { data, error } = await supabase.from('app_config').select('value').eq('key', KEY).maybeSingle();
  if (error) throw new Error(`Downloading admin PIN failed: ${error.message}`);
  if (!data) return undefined;
  return data.value;
}
