import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { db } from './db';

/**
 * Sign-in for the ACTIVE project's own Supabase backend. Each farm keeps its own users (a
 * technician only exists in their farm's project; a coordinator has an account in every farm
 * they need). supabase-js persists each project's session under its own localStorage key, so a
 * coordinator signs into each farm once and switching between them afterwards is instant.
 *
 * Users are created by the admin in the Supabase dashboard (Authentication -> Users -> Add
 * user). Their ROLE lives in the `profiles` table (see supabase/auth-migration.sql), which the
 * admin edits from Settings -> Users in the app.
 */
export type Role = 'technician' | 'coordinator' | 'admin';

export interface Profile {
  userId: string;
  email: string | null;
  displayName: string;
  role: Role;
  active: boolean;
}

export async function signIn(email: string, password: string): Promise<User> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This project has no backend configured yet.');
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendlyAuthError(error.message));
  return data.user;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function currentSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/** The signed-in user's profile. A user who signs in for the first time and has no profile row
 * yet gets one created as 'technician' (the DB trigger normally does this at user creation;
 * this is the fallback). Also mirrors the user into the local `operators` table so every
 * existing "who did this" display keeps resolving names the same way it always has. */
export async function loadProfile(user: User): Promise<Profile> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('No backend.');
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(`Couldn't load your profile: ${error.message}`);
  let row = data;
  if (!row) {
    const fallbackName = (user.user_metadata?.display_name as string | undefined) || user.email?.split('@')[0] || 'User';
    const ins = await supabase
      .from('profiles')
      .insert({ user_id: user.id, email: user.email ?? null, display_name: fallbackName, role: 'technician', active: true })
      .select('*')
      .single();
    if (ins.error) throw new Error(`Couldn't create your profile: ${ins.error.message}`);
    row = ins.data;
  }
  const profile: Profile = {
    userId: row.user_id,
    email: row.email ?? user.email ?? null,
    displayName: row.display_name,
    role: row.role as Role,
    active: row.active !== false,
  };
  await db.operators.put({ operatorId: profile.userId, name: profile.displayName, active: profile.active, role: profile.role });
  return profile;
}

export async function listProfiles(): Promise<Profile[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.from('profiles').select('*').order('display_name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    userId: r.user_id,
    email: r.email ?? null,
    displayName: r.display_name,
    role: r.role as Role,
    active: r.active !== false,
  }));
}

export async function updateProfile(userId: string, patch: Partial<Pick<Profile, 'displayName' | 'role' | 'active'>>): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.active !== undefined) row.active = patch.active;
  const { error } = await supabase.from('profiles').update(row).eq('user_id', userId);
  if (error) throw new Error(error.message);
  const local = await db.operators.get(userId);
  if (local) await db.operators.put({ ...local, name: patch.displayName ?? local.name, active: patch.active ?? local.active, role: patch.role ?? local.role });
}

export async function changeOwnPassword(newPassword: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

function friendlyAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(msg)) return 'This account has not been confirmed yet -- ask the admin.';
  return msg;
}
