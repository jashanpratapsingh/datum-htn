import { redirect } from 'next/navigation';
import PageShell from '@/components/PageShell';
import LoginForm from '@/components/auth/LoginForm';
import WalletLogin from '@/components/auth/WalletLogin';
import { getViewer } from '@/lib/auth/viewer';
import { hasSupabaseEnv } from '@/lib/supabase/env';

function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/account';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  // Either login counts: an email session or a connected Phantom wallet.
  if (await getViewer()) redirect(target);

  return (
    <PageShell
      title="Sign in"
      subtitle="An account holds the agents you connect, their budgets and every reading they buy. Phantom first; email and password if you have no wallet."
      stamp={hasSupabaseEnv() ? 'supabase auth' : 'auth not configured'}
    >
      {hasSupabaseEnv() ? (
        <div className="flex flex-col gap-6">
          <WalletLogin next={target} />
          <p className="plate text-center">or with email</p>
          <LoginForm next={target} />
        </div>
      ) : (
        <div className="panel px-6 py-12 text-center">
          <p className="plate mb-3">Accounts are not configured on this deployment</p>
          <p className="readout text-xs text-ink-muted">set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</p>
        </div>
      )}
    </PageShell>
  );
}
