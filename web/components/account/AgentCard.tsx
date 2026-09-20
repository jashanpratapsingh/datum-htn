import { Readout } from '@/components/Panel';
import FundAgentWallet from '@/components/oauth/FundAgentWallet';
import { revokeAgent, updateCaps } from '@/app/account/actions';
import type { AgentView } from '@/lib/dashboard';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const usd = (micro: number | null) => (micro === null ? '—' : (micro / 1e6).toFixed(4));
const input = 'readout w-24 rounded-[8px] border border-rule bg-pill px-2.5 py-1.5 text-sm text-ink focus:border-ink focus:outline-none';

/** One connected agent: identity, wallet + balance, caps (editable), connections, fund, revoke. */
export default function AgentCard({ agent }: { agent: AgentView }) {
  const a = agent;
  return (
    <li id={`agent-${a.id}`} className="flex flex-col [&+&]:border-t [&+&]:border-rule" data-agent={a.revokedAt ? 'revoked' : 'active'}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <p className={`text-[17px] ${a.revokedAt ? 'text-ink-muted line-through' : 'text-ink'}`}>{a.name}</p>
          <p className="readout text-[11px] text-ink-muted">
            {a.createdVia === 'oauth' ? `connected via ${a.clientName ?? 'OAuth'}` : `API key ${a.keyPrefix}…`} · created {when(a.createdAt)}
            {a.lastUsedAt ? ` · last used ${when(a.lastUsedAt)}` : ' · never used'}
            {a.revokedAt ? ` · revoked ${when(a.revokedAt)}` : ''}
            {a.connections.length ? ` · ${a.connections.length} active session${a.connections.length === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        {!a.revokedAt && (
          <form action={revokeAgent}>
            <input type="hidden" name="id" value={a.id} />
            <button type="submit" className="readout text-xs text-ink-muted underline underline-offset-2 hover:text-alarm">
              revoke
            </button>
          </form>
        )}
      </div>

      {!a.revokedAt && (
        <>
          <div className="grid grid-cols-2 border-t border-rule sm:grid-cols-4">
            <Readout label="wallet USDC" value={a.balance ? usd(a.balance.usdcMicro ?? 0) : '…'} unit="devnet" size="sm" />
            <div className="panel-divide-x">
              <Readout label="wallet SOL" value={a.balance ? (a.balance.lamports / 1e9).toFixed(4) : '…'} size="sm" tone={a.balance && a.balance.lamports < 5_000_000 ? 'alarm' : 'ink'} />
            </div>
            <div className="border-t border-rule sm:panel-divide-x sm:border-t-0">
              <Readout label="spent · lifetime" value={usd(a.spentMicro)} unit="USDC" size="sm" />
            </div>
            <div className="panel-divide-x border-t border-rule sm:border-t-0">
              <Readout label="caps · per reading / day" value={<span className="text-base">{usd(a.perRequestCapMicro)} / {a.dailyCapMicro === null ? '∞' : usd(a.dailyCapMicro)}</span>} size="sm" />
            </div>
          </div>

          <form action={updateCaps} className="flex flex-wrap items-end gap-3 border-t border-rule px-4 py-3">
            <input type="hidden" name="id" value={a.id} />
            <label className="flex flex-col gap-1">
              <span className="plate">per reading · USDC</span>
              <input name="per_request_cap" inputMode="decimal" defaultValue={(a.perRequestCapMicro / 1e6).toString()} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="plate">per day · USDC (0 = none)</span>
              <input name="daily_cap" inputMode="decimal" defaultValue={a.dailyCapMicro === null ? '0' : (a.dailyCapMicro / 1e6).toString()} className={input} />
            </label>
            <button type="submit" className="readout rounded-full border border-ink px-4 py-1.5 text-xs text-ink transition-colors hover:bg-ink hover:text-canvas">
              save caps
            </button>
            <span className="text-xs text-ink-muted">Checked in the database before every transfer.</span>
          </form>

          {a.walletPubkey ? (
            <div className="border-t border-rule">
              <FundAgentWallet agentId={a.id} walletPubkey={a.walletPubkey} back={null} embedded />
            </div>
          ) : (
            <p className="border-t border-rule px-4 py-3 text-sm text-ink-muted">No wallet yet: it is created the first time this agent calls the MCP server.</p>
          )}
        </>
      )}
    </li>
  );
}
