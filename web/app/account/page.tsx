import { redirect } from 'next/navigation';
import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import { SalesReceipt, type ReceiptLine } from '@/components/SalesReceipt';
import { SourceBadge } from '@/components/SourceBadge';
import NewAgentForm from '@/components/account/NewAgentForm';
import AgentCard from '@/components/account/AgentCard';
import ActivityChart from '@/components/account/ActivityChart';
import SpendChart from '@/components/account/SpendChart';
import { getSessionUser } from '@/lib/supabase/server';
import { displayNameOf } from '@/lib/auth/user';
import { loadDashboard } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

/**
 * The buyer dashboard: connected agents (wallets, caps, sessions), what they
 * read (activity over time, per device), what they spent, and every
 * transaction. Everything is read as the signed-in user through RLS.
 */
export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=%2Faccount');

  const { agents, readings, sales, unchartedReadings } = await loadDashboard();
  const active = agents.filter((a) => !a.revokedAt);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const totalMicro = sales.reduce((s, r) => s + r.amountMicro, 0);
  const walletMicro = active.reduce((s, a) => s + (a.balance?.usdcMicro ?? 0), 0);
  const sources = new Set(sales.map((s) => s.source));

  const lines: ReceiptLine[] = sales.slice(0, 100).map((s) => ({
    key: s.id,
    signature: s.txSignature,
    amount: String(s.amountMicro),
    network: s.network,
    nonce: s.nonce,
    timestamp: Math.floor(Date.parse(s.settledAt) / 1000),
    note: `${s.deviceId ?? 'device'} · ${s.source} · ${s.agentId ? `via agent ${agentName.get(s.agentId) ?? s.agentId.slice(0, 8)}` : 'via web'}`,
  }));

  return (
    <PageShell
      title="Account"
      subtitle="Your connected agents, the wallets they pay from, what they read and every transaction behind it."
      stamp={displayNameOf(user)}
    >
      <div className="flex flex-col gap-5">
        <Panel label="Account" stamp="signed in">
          <div className="grid grid-cols-2 sm:grid-cols-4">
            <Readout label="identity" value={<span className="break-all text-base">{displayNameOf(user)}</span>} size="sm" />
            <div className="panel-divide-x">
              <Readout label="agents" value={active.length} unit="active" />
            </div>
            <div className="border-t border-rule sm:panel-divide-x sm:border-t-0">
              <Readout label="in agent wallets" value={(walletMicro / 1e6).toFixed(4)} unit="USDC" />
            </div>
            <div className="panel-divide-x border-t border-rule sm:border-t-0">
              <Readout label="spent" value={(totalMicro / 1e6).toFixed(4)} unit="USDC" tone="amber" />
            </div>
          </div>
        </Panel>

        <Panel label="Agents" stamp={active.length ? `${active.length} connected` : 'none yet'}>
          {agents.length === 0 ? (
            <div className="px-4 py-8">
              <p className="readout mb-2 text-sm text-ink-muted">No agents yet.</p>
              <p className="mb-4 text-sm text-ink-muted">
                The quickest way is the one-liner on <a href="/connect" className="text-ink underline underline-offset-2">/connect</a>: your coding agent opens this site and you approve. Or register one below to get a static API key.
              </p>
            </div>
          ) : (
            <ul>
              {agents.map((a) => (
                <AgentCard key={a.id} agent={a} />
              ))}
            </ul>
          )}
          <div className="panel-divide">
            <NewAgentForm />
          </div>
        </Panel>

        <Panel label="Activity" stamp={readings.length ? `${readings.length} readings · 24 h` : '24 h'}>
          <ActivityChart readings={readings} />
          {unchartedReadings > 0 && (
            <p className="panel-divide px-4 py-2.5 text-[12px] text-ink-muted">
              {unchartedReadings} reading{unchartedReadings === 1 ? '' : 's'} in the window carried no activity number (badge health payloads) and are listed under transactions only.
            </p>
          )}
        </Panel>

        <Panel label="Spend" stamp={sales.length ? `${sales.length} transaction${sales.length === 1 ? '' : 's'}` : 'none yet'}>
          <SpendChart sales={sales} />
        </Panel>

        <Panel
          label="Transactions"
          stamp={
            <span className="flex items-center gap-2">
              {[...sources].map((s) => (
                <SourceBadge key={s} source={s} />
              ))}
            </span>
          }
        >
          {sales.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="readout mb-4 text-sm text-ink-muted">No purchases yet.</p>
              <Pill href="/connect">Connect an agent</Pill>
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
