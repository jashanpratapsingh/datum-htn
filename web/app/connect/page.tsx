import { headers } from 'next/headers';
import PageShell from '@/components/PageShell';
import { Panel } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import InstallSnippets from '@/components/connect/InstallSnippets';
import { oauthSnippets, mcpUrl } from '@/lib/connect/snippets';
import { originFromHeaders } from '@/lib/oauth/origin';
import { getViewer } from '@/lib/auth/viewer';

export const dynamic = 'force-dynamic';

const TOOLS: Array<[string, string]> = [
  ['vendx_list_devices', 'what is for sale, price per reading, live or not, and whether it is hardware or a simulator'],
  ['vendx_buy_reading', 'pays real devnet USDC from the agent wallet, settles through the relay, returns telemetry + the transaction'],
  ['vendx_reading_history', 'what this connection already bought, with min / max / mean / trend so it can decide without re-buying'],
  ['vendx_budget_status', 'wallet balance, caps, spent today; where to top up'],
  ['vendx_transactions', 'the on-chain money trail with Solscan links'],
];

/** The public "plug your coding agent in" page: one command per client. */
export default async function ConnectPage() {
  const origin = originFromHeaders(await headers());
  const user = await getViewer();
  return (
    <PageShell
      title="Connect your coding agent"
      subtitle="One command. The agent opens this site, you approve once and fund a small wallet for it, and from then on it buys sensor readings on its own — inside the caps you set."
      stamp="mcp · oauth 2.1"
    >
      <div className="flex flex-col gap-5">
        <InstallSnippets snippets={oauthSnippets(origin)} />

        <Panel label="What happens" stamp="4 steps">
          <ol className="grid grid-cols-1 sm:grid-cols-4">
            {[
              ['1 · add', 'The client registers itself with our authorization server and opens the browser.'],
              ['2 · approve', 'Sign in with Phantom (or email), name the agent, set a per-reading and a daily cap.'],
              ['3 · fund', 'Send a little devnet USDC and SOL to the agent wallet from Phantom. Its balance is the hard budget.'],
              ['4 · buy', 'The agent lists sensors, buys readings and reasons over them. Every purchase is a real transaction you can see here.'],
            ].map(([k, v]) => (
              <li key={k} className="px-4 py-4 [&+&]:border-t [&+&]:border-rule sm:[&+&]:border-l sm:[&+&]:border-t-0">
                <p className="plate mb-1">{k}</p>
                <p className="text-sm leading-relaxed text-ink">{v}</p>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel label="Tools the agent gets" stamp={<span className="readout">{mcpUrl(origin)}</span>}>
          <ul>
            {TOOLS.map(([name, what]) => (
              <li key={name} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-6 [&+&]:border-t [&+&]:border-rule">
                <span className="readout shrink-0 text-sm text-ink sm:w-56">{name}</span>
                <span className="text-sm text-ink-muted">{what}</span>
              </li>
            ))}
          </ul>
          <p className="panel-divide px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
            Every reading carries <span className="readout text-ink">source</span>: <span className="readout">esp32c3</span> is a WiFi ESP32 node,{' '}
            <span className="readout">badge</span> the Hack the North badge over USB, <span className="readout">simulator</span> synthetic data. The agent is told to say which.
          </p>
        </Panel>

        <div className="flex flex-wrap items-center gap-3">
          <Pill href={user ? '/account' : '/login?next=%2Faccount'}>{user ? 'Your agents, budgets and readings →' : 'Sign in to see your agents →'}</Pill>
          <span className="text-sm text-ink-muted">Prefer a static key? Register an agent on your account page and use the bearer-header variant.</span>
        </div>
      </div>
    </PageShell>
  );
}
