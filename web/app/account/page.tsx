import { redirect } from 'next/navigation';
import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import { SalesReceipt, type ReceiptLine } from '@/components/SalesReceipt';
import NewAgentForm from '@/components/account/NewAgentForm';
import { revokeAgent } from './actions';
import { createSupabaseServer, getSessionUser } from '@/lib/supabase/server';
import { displayNameOf } from '@/lib/auth/user';

export const dynamic = 'force-dynamic';

interface AgentRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
interface SaleRow {
  id: string;
  nonce: string;
  relay_id: string;
  device_id: string | null;
  source: 'badge' | 'simulator' | 'esp32c3';
  amount_micro_usdc: number | string;
  tx_signature: string;
  network: string;
  agent_id: string | null;
  settled_at: string;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Faccount');

  const supabase = await createSupabaseServer();
  const [agentsRes, salesRes] = await Promise.all([
    supabase
      .from('vendx_agents')
      .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('vendx_sales')
      .select('id, nonce, relay_id, device_id, source, amount_micro_usdc, tx_signature, network, agent_id, settled_at')
      .order('settled_at', { ascending: false })
      .limit(50),
  ]);
  const agents = (agentsRes.data ?? []) as AgentRow[];
  const sales = (salesRes.data ?? []) as SaleRow[];
  const active = agents.filter((a) => !a.revoked_at);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const totalMicro = sales.reduce((s, r) => s + Number(r.amount_micro_usdc), 0);

  const lines: ReceiptLine[] = sales.map((s) => ({
    key: s.id,
    signature: s.tx_signature,
    amount: String(s.amount_micro_usdc),
    network: s.network,
    nonce: s.nonce,
    timestamp: Math.floor(Date.parse(s.settled_at) / 1000),
    note: `${s.device_id ?? 'device'} · ${s.source} · ${s.agent_id ? `via agent ${agentName.get(s.agent_id) ?? s.agent_id.slice(0, 8)}` : 'via web'}`,
  }));

  return (
    <PageShell
      title="Account"
      subtitle="Your agents, their keys, and every reading they have bought. Purchases made from this site with the shared devnet wallet land here too."
      stamp={displayNameOf(user)}
    >
      <div className="flex flex-col gap-5">
        <Panel label="Account" stamp="signed in">
          <div className="grid grid-cols-1 sm:grid-cols-3">
            <Readout label="identity" value={<span className="break-all text-base">{displayNameOf(user)}</span>} size="sm" />
            <div className="panel-divide sm:panel-divide-x sm:border-t-0">
              <Readout label="agents" value={active.length} unit={active.length === 1 ? 'active' : 'active'} />
            </div>
            <div className="panel-divide sm:panel-divide-x sm:border-t-0">
              <Readout label="spent" value={(totalMicro / 1e6).toFixed(4)} unit="USDC" tone="amber" />
            </div>
          </div>
        </Panel>

        <Panel label="Agents" stamp={`${active.length} registered`}>
          {agents.length === 0 ? (
            <p className="readout px-4 py-6 text-sm text-ink-muted">
              No agents yet. Register one below to get an API key for Claude Code.
            </p>
          ) : (
            <ul>
              {agents.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 [&+&]:border-t [&+&]:border-rule">
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] ${a.revoked_at ? 'text-ink-muted line-through' : 'text-ink'}`}>{a.name}</p>
                    <p className="readout text-[11px] text-ink-muted">
                      {a.key_prefix}… · created {when(a.created_at)}
                      {a.last_used_at ? ` · last used ${when(a.last_used_at)}` : ' · never used'}
                      {a.revoked_at ? ` · revoked ${when(a.revoked_at)}` : ''}
                    </p>
                  </div>
                  {!a.revoked_at && (
                    <form action={revokeAgent}>
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" className="readout text-xs text-ink-muted underline underline-offset-2 hover:text-alarm">
                        revoke
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="panel-divide">
            <NewAgentForm />
          </div>
        </Panel>

        <Panel label="Purchases" stamp={`${sales.length} reading${sales.length === 1 ? '' : 's'}`}>
          {sales.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="readout mb-4 text-sm text-ink-muted">No purchases yet.</p>
              <Pill href="/agent">Buy a reading from the agent console</Pill>
            </div>
          ) : (
            <div className="px-4 py-5">
              <SalesReceipt lines={lines} title="your purchases" footer="every line is a real devnet transaction" />
            </div>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
