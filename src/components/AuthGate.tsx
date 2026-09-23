import { useEffect, useState, type ReactNode } from 'react';
import { hasSupabase } from '@/lib/supabase';
import { currentSession, loadProfile, onAuthChange, signIn } from '@/lib/auth';
import { useSession } from '@/store/session';
import { activeProjectConfig } from '@/store/project';
import { Link } from 'react-router-dom';
import { initializeData } from '@/lib/initData';

/** Replaces the old "pick your name" OperatorGate. Nothing renders until the person has
 * signed in to the ACTIVE project's backend and their profile (name + role) is loaded into the
 * session store -- so every report/replacement is attributed to a real account, and admin
 * tools can check a real role instead of a shared PIN. A project without a backend (none
 * configured yet) falls back to the old behaviour so local-only use keeps working. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { operatorId, setOperator, clearOperator } = useSession();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const project = activeProjectConfig();

  /** First sign-in on a fresh device: pull this farm's panels now (boot skipped it because
   * nobody was signed in yet). */
  async function ensureDataLoaded() {
    setDownloading('Preparing...');
    try {
      await initializeData((text) => setDownloading(text));
    } finally {
      setDownloading(null);
    }
  }

  useEffect(() => {
    if (!hasSupabase()) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const session = await currentSession();
        if (session?.user) {
          const profile = await loadProfile(session.user);
          if (!cancelled) {
            if (!profile.active) {
              setError('Your account is disabled. Ask an admin.');
              clearOperator();
            } else {
              setOperator(profile.userId, profile.displayName, profile.role);
            }
          }
        } else if (!cancelled) {
          clearOperator();
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    const off = onAuthChange((session) => {
      if (!session) clearOperator();
    });
    return () => {
      cancelled = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasSupabase()) return <>{children}</>; // local-only project: nothing to sign in to
  if (checking || downloading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-slate-400">
        {downloading ?? 'Checking your session...'}
      </div>
    );
  }
  if (operatorId) return <>{children}</>;

  async function submit() {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const user = await signIn(email, password);
      const profile = await loadProfile(user);
      if (!profile.active) {
        setError('Your account is disabled. Ask an admin.');
        return;
      }
      await ensureDataLoaded();
      setOperator(profile.userId, profile.displayName, profile.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <div className="horizon-line" />
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="card-premium w-full max-w-sm rounded-2xl p-6">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-accent-amber">GRS · Panel Manager</div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-50">{project.name}</h1>
          <p className="mb-5 mt-1 text-sm text-slate-400">Sign in to continue.</p>

          {error && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-sm text-status-pending">{error}</div>}

          <label className="mb-3 block">
            <span className="text-xs text-slate-400">Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-base text-slate-100"
            />
          </label>
          <label className="mb-5 block">
            <span className="text-xs text-slate-400">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-base text-slate-100"
            />
          </label>
          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded-xl btn-primary px-4 py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Signing in...' : 'Sign in'}
          </button>

          <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
            <Link to="/projects" className="underline hover:text-slate-300">
              Different project?
            </Link>
            <span>No account? Ask your admin.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
