import { redirect } from 'next/navigation';
import PageShell from '@/components/PageShell';
import FundAgentWallet from '@/components/oauth/FundAgentWallet';
import { getSessionUser } from '@/lib/supabase/server';
import { requireSupabaseAdmin } from '@/lib/supabase/admin';
import { parseRedirectUri } from '@/lib/oauth/redirect';

export const dynamic = 'force-dynamic';

/**
 * After consent: the agent exists and has a wallet; the client's redirect
 * (with the one-time code) is in `back`. The owner funds the wallet here and
 * then continues to the client, or continues first and funds later.
 */
export default async function DonePage({ searchParams }: { searchParams: Promise<{ agent?: string; wallet?: string; client?: string; back?: string }> }) {
  const { agent, wallet, client, back } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Faccount');
  if (!agent || !wallet || !/^[0-9a-f-]{36}$/i.test(agent)) redirect('/account');

  // Only ever link back to a URL that passes the redirect rules (https or loopback).
  const backUrl = back && parseRedirectUri(back) ? back : null;

  const sb = requireSupabaseAdmin();
  const own = await sb.from('vendx_agents').select('id, name, wallet_pubkey').eq('id', agent).eq('user_id', user.id).maybeSingle();
  const row = own.data as { id: string; name: string; wallet_pubkey: string | null } | null;
  if (!row || row.wallet_pubkey !== wallet) redirect('/account');

  return (
    <PageShell
      title={`${client ?? 'Your agent'} is connected`}
      subtitle={`It acts as "${row.name}". Give its wallet some devnet USDC so it can buy readings, then head back.`}
      stamp="step 2 of 2 · fund"
    >
      <FundAgentWallet agentId={row.id} walletPubkey={wallet} back={backUrl} clientName={client} />
    </PageShell>
  );
}
