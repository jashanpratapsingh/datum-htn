'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createSupabaseBrowser } from '@/lib/supabase/browser';
import { hasSupabaseEnv } from '@/lib/supabase/env';
import { displayNameOf, walletOfUser } from '@/lib/auth/user';
import { signOut } from '@/app/auth/actions';
import { usePhantom } from '@/components/wallet/WalletProvider';

/**
 * Who is signed in, in the nav. Self-hydrating so NavBar can stay a plain
 * client component mounted from every page; renders nothing until the
 * session is known, so it never flashes the wrong state.
 *
 * A connected Phantom wallet IS a login (its pill sits right next to this),
 * so while the wallet is connected — or still deciding — there is no
 * "Sign in" to offer, and no second name to print for the same wallet.
 */
export default function AuthStatus({ compact = false }: { compact?: boolean }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const wallet = usePhantom();

  useEffect(() => {
    if (!hasSupabaseEnv()) {
      setUser(null);
      return;
    }
    const supabase = createSupabaseBrowser();
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (user === undefined) return null;

  const walletPending = wallet.status === 'idle' || wallet.status === 'connecting';
  const walletConnected = wallet.status === 'connected' && Boolean(wallet.wallet);
  // Without Supabase the link below is "Get in touch", not a login: keep it.
  if (!user && hasSupabaseEnv() && (walletPending || walletConnected)) return null;
  if (user && walletConnected && walletOfUser(user) === wallet.wallet) return null;

  const linkClass = compact
    ? 'text-[20px] text-ink/70 hover:text-ink transition-colors'
    : 'text-[15px] text-ink underline underline-offset-4 decoration-ink/40 hover:decoration-ink';

  if (!user) {
    if (!hasSupabaseEnv()) {
      return (
        <a href="mailto:hello@vendx.dev" className={linkClass}>
          Get in touch
        </a>
      );
    }
    return (
      <a href="/login" className={linkClass}>
        Sign in
      </a>
    );
  }

  return (
    <span className={`flex items-center ${compact ? 'flex-col items-start gap-3' : 'gap-4'}`}>
      <a href="/account" className={`${linkClass} readout max-w-[220px] truncate`} title={displayNameOf(user)}>
        {displayNameOf(user)}
      </a>
      <form action={signOut}>
        <button type="submit" className={compact ? 'text-[20px] text-ink/60 hover:text-ink' : 'text-[15px] text-ink-muted hover:text-ink transition-colors'}>
          Sign out
        </button>
      </form>
    </span>
  );
}
