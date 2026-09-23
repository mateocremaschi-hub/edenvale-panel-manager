import { useSession } from '@/store/session';

/**
 * Admin-only gate. Historically this prompted for a shared admin PIN; now that everyone signs
 * in with their own account, "admin" is a ROLE on the user's profile (Settings -> Users). Kept
 * the old name and signature so the many existing call sites didn't all need rewriting -- the
 * PIN arguments are ignored. Returns true if the signed-in user is an admin; otherwise shows
 * why and returns false so the caller bails out.
 */
export async function requireAdminPin(_currentPinHash?: string | null, _onMigrate?: (h: string) => void, _promptText?: string): Promise<boolean> {
  const { role } = useSession.getState();
  if (role === 'admin') return true;
  alert('Admin only -- ask an admin to do this, or to make your account an admin.');
  return false;
}

export function isAdmin(): boolean {
  return useSession.getState().role === 'admin';
}
