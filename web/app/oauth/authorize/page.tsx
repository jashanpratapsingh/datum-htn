import { redirect } from 'next/navigation';
import PageShell from '@/components/PageShell';
import ConsentForm, { type AgentOption } from '@/components/oauth/ConsentForm';
import { getSessionUser } from '@/lib/supabase/server';
import { requireSupabaseAdmin } from '@/lib/supabase/admin';
import { checkAuthorize, pick, withParams } from '@/lib/oauth/authorize';
import { displayNameOf } from '@/lib/auth/user';

export const dynamic = 'force-dynamic';

/**
 * GET /oauth/authorize — the browser step of connecting a coding agent.
 * Unknown client or redirect → an error page here (never a redirect to an
 * unverified URL); other errors go back to the client; no session → /login
 * with this exact URL as `next`.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const params = pick(sp);
  const check = await checkAuthorize(params);

  if (!check.ok && check.fatal) {
    return (
      <PageShell title="Cannot connect" subtitle="The connection request was not valid, so nothing was authorised." stamp={check.error}>
        <div className="panel mx-auto max-w-xl px-6 py-8">
          <p className="text-[15px] text-ink">{check.description}</p>
          <p className="mt-3 text-sm text-ink-muted">
            Re-run the install command in your coding agent; it registers itself again. See <a href="/connect" className="text-ink underline underline-offset-2">/connect</a>.
          </p>
        </div>
      </PageShell>
    );
  }
  if (!check.ok) redirect(withParams(check.redirectUri, { error: check.error, error_description: check.description, state: check.state }));

  const user = await getSessionUser();
  if (!user) {
    const here = withParams('/oauth/authorize', Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'string')) as Record<string, string>);
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }

  const sb = requireSupabaseAdmin();
  const rows = await sb
    .from('vendx_agents')
    .select('id, name, client_name, wallet_pubkey, daily_cap_micro_usdc, per_request_cap_micro_usdc')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(20);
  const agents: AgentOption[] = ((rows.data ?? []) as Array<{ id: string; name: string; client_name: string | null; wallet_pubkey: string | null; daily_cap_micro_usdc: number | string | null; per_request_cap_micro_usdc: number | string }>).map((a) => ({
    id: a.id,
    name: a.name,
    clientName: a.client_name,
    walletPubkey: a.wallet_pubkey,
    dailyCapUsd: a.daily_cap_micro_usdc === null ? null : Number(a.daily_cap_micro_usdc) / 1_000_000,
    perRequestCapUsd: Number(a.per_request_cap_micro_usdc) / 1_000_000,
  }));

  const clientName = check.client.client_name ?? 'Your coding agent';
  const hidden: Record<string, string> = {
    client_id: check.client.client_id,
    redirect_uri: check.redirectUri,
    code_challenge: check.challenge,
    scope: check.scope,
    ...(check.state ? { state: check.state } : {}),
    ...(check.resource ? { resource: check.resource } : {}),
  };

  return (
    <PageShell title="Connect an agent" subtitle="Approve once. From then on the agent buys readings on its own, from a wallet you fund, inside the caps you set here." stamp="oauth 2.1 · pkce">
      <ConsentForm clientName={clientName} scope={check.scope} hidden={hidden} agents={agents} viewerLabel={displayNameOf(user)} />
    </PageShell>
  );
}
