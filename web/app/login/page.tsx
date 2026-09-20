import { redirect } from 'next/navigation';
import PageShell from '@/components/PageShell';
import LoginForm from '@/components/auth/LoginForm';
import { getSessionUser } from '@/lib/supabase/server';
import { hasSupabaseEnv } from '@/lib/supabase/env';

function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/account';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const user = await getSessionUser();
  if (user) redirect(target);

  return (
    <PageShell
      title="Sign in"
      subtitle="An account holds the agents you register and every reading they buy. Email and password, nothing sent to your inbox."
      stamp={hasSupabaseEnv() ? 'supabase auth' : 'auth not configured'}
    >
      {hasSupabaseEnv() ? (
        <LoginForm next={target} />
      ) : (
        <div className="panel px-6 py-12 text-center">
          <p className="plate mb-3">Accounts are not configured on this deployment</p>
          <p className="readout text-xs text-ink-muted">set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</p>
        </div>
      )}
    </PageShell>
  );
}
