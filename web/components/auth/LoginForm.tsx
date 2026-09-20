'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase/browser';

type Mode = 'signin' | 'signup';

/**
 * Email + password, no confirmation email: an account exists the moment the
 * form submits. The browser client writes the session cookies; the next
 * server render (router.refresh) sees them.
 */
export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowser();
    const res =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (res.error) {
      setError(res.error.message);
      setBusy(false);
      return;
    }
    if (mode === 'signup' && !res.data.session) {
      // Only happens if confirmations were switched on in the Supabase dashboard.
      setError('Account created. Confirm the email we sent, then sign in.');
      setMode('signin');
      setBusy(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const inputClass =
    'readout w-full rounded-[8px] border border-rule bg-pill px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-muted/60 focus:border-ink focus:outline-none';

  return (
    <div className="panel mx-auto w-full max-w-md">
      <div className="flex border-b border-rule" role="tablist" aria-label="Sign in or create account">
        {(['signin', 'signup'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError(null); }}
            className={`flex-1 px-4 py-3 text-[15px] transition-colors ${
              mode === m ? 'text-ink' : 'text-ink-muted hover:text-ink'
            } ${m === 'signup' ? 'panel-divide-x' : ''}`}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4 px-5 py-6">
        <label className="flex flex-col gap-1.5">
          <span className="plate">email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="plate">password{mode === 'signup' ? ' · at least 6 characters' : ''}</span>
          <input
            type="password"
            name="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>

        {error && (
          <p className="border-l-2 border-alarm px-3 py-1.5 text-sm text-alarm" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="readout mt-1 inline-flex items-center justify-center rounded-full border border-ink bg-ink px-6 py-2.5 text-sm text-canvas transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <p className="text-xs leading-relaxed text-ink-muted">
          No confirmation email. Your account holds the agents you register and every reading they buy.
        </p>
      </form>
    </div>
  );
}
