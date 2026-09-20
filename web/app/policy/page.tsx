import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { RelayOffline } from '@/components/RelayOffline';
import { RelayDark } from '@/components/RelayTag';
import { fetchPolicy, MULTI_RELAY } from '@/lib/relay';

const DAY_CAP_USD = 5.0;

function ArcGauge({ spentMicro, capMicro }: { spentMicro: string; capMicro: string }) {
  const spent = Number(spentMicro) / 1e6;
  const cap = Number(capMicro) / 1e6;
  // A full 1.0 degenerates the arc into a point; clamp just under.
  const pct = Math.min(spent / cap, 0.9999);
  const remaining = Math.max(cap - spent, 0);
  // This gauge IS money, so amber is earned here. Alarm past 85%.
  const tone = pct < 0.6 ? '#141414' : pct < 0.85 ? '#141414' : '#b93a2e';

  const r = 70, cx = 100, cy = 90;
  const bg = `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy}`;
  const ex = cx + r * Math.cos(Math.PI - pct * Math.PI);
  const ey = cy - r * Math.sin(pct * Math.PI);
  const fg = pct > 0.001 ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${ex} ${ey}` : '';

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-8">
      <div className="relative w-60">
        <svg viewBox="0 0 200 100" className="w-full" aria-hidden="true">
          <path d={bg} fill="none" stroke="#cdc8bf" strokeWidth="12" />
          {fg && <path d={fg} fill="none" stroke={tone} strokeWidth="12" style={{ filter: `drop-shadow(0 0 6px ${tone}88)` }} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <div className="readout  leading-none" style={{ fontSize: '2.25rem', color: remaining < 0.5 ? '#b93a2e' : '#141414' }}>
            {remaining.toFixed(2)}
          </div>
          <div className="plate mt-1.5">USDC left today</div>
        </div>
      </div>

      <div className="grid w-full grid-cols-3 border-t border-rule">
        <Readout label="spent" value={spent.toFixed(4)} tone="amber" size="sm" />
        <div className="panel-divide-x"><Readout label="daily cap" value={cap.toFixed(2)} size="sm" /></div>
        <div className="panel-divide-x"><Readout label="used" value={`${(pct * 100).toFixed(1)}%`} tone={pct >= 0.85 ? 'alarm' : 'ink'} size="sm" /></div>
      </div>
      <p className="plate">resets at midnight UTC</p>
    </div>
  );
}

const RULES: [string, string][] = [
  ['Daily cap', `$${DAY_CAP_USD.toFixed(2)} USDC per UTC day`],
  ['Enforcement', 'canSpend() runs before every transfer'],
  ['Persistence', 'data/spend-ledger.json — survives a restart'],
  ['Reset', 'Midnight UTC, checked on every load'],
  ['Over-spend guard', 'Spend is recorded before the receipt is replayed'],
  ['Network', 'solana-devnet only, in simulator mode'],
];

export default async function PolicyPage() {
  const result = await fetchPolicy();
  // One policy per relay: the budget is the buyer agent's on that relay's
  // machine, so two relays mean two gauges, never one summed number.
  const policies = result.ok ? result.data : [];
  // `denials` is undefined when the relay does not serve a log — distinct from an empty one.
  const denials = policies[0]?.denials;

  return (
    <PageShell
      title="Policy engine"
      subtitle="The APEX spend budget. Every denial is logged. The guard is mechanical, not advisory."
      stamp={result.ok ? policies[0]?.date : 'no link'}
    >
      <div className="flex flex-col gap-5">
        {!result.ok ? (
          <RelayOffline path="/api/policy" reason={result.reason} />
        ) : (
          <>
            {policies.map((p) => (
              <Panel key={p.relay.key} label={MULTI_RELAY ? `Today's spend · ${p.relay.label}` : "Today's spend"} live>
                <ArcGauge spentMicro={p.spentMicroUsdc} capMicro={p.dailyCapMicroUsdc} />
              </Panel>
            ))}
            {result.failed.map((f) => (
              <Panel key={f.relay.key} label={`Today's spend · ${f.relay.label}`}>
                <RelayDark relay={f.relay} message={f.message} />
              </Panel>
            ))}
          </>
        )}

        <Panel label="Enforcement rules">
          <dl className="grid grid-cols-1 md:grid-cols-2">
            {RULES.map(([k, v], i) => (
              <div key={k} className={`px-4 py-3.5 ${i > 0 ? 'panel-divide' : ''} ${i % 2 === 1 ? 'md:panel-divide-x' : ''} ${i < 2 ? 'md:border-t-0' : ''}`}>
                <dt className="plate mb-1">{k}</dt>
                <dd className="text-[15px] text-ink/85">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        {result.ok && (
          <Panel
            label="Denial log"
            stamp={denials === undefined ? 'not reported' : <span className={denials.length ? 'text-alarm' : ''}>{denials.length} today</span>}
          >
            {denials === undefined ? (
              <p className="readout px-4 py-10 text-center text-sm text-ink-muted">
                The relay does not report denials yet. The cap is still enforced — see the gauge above.
              </p>
            ) : denials.length === 0 ? (
              <p className="readout px-4 py-10 text-center text-sm text-ink-muted">
                No denials today. The budget has not been reached.
              </p>
            ) : (
              <ul>
                {denials.map((d, i) => (
                  <li key={i} className="panel-divide flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3">
                    <div className="min-w-0">
                      <p className="readout text-xs text-alarm">{d.reason}</p>
                      {d.deviceId && <p className="readout truncate text-[11px] text-ink-muted">{d.deviceId}</p>}
                    </div>
                    <div className="flex items-center gap-5">
                      <span className="readout text-xs text-ink">{(Number(d.amount) / 1e6).toFixed(6)}</span>
                      <span className="readout text-[11px] text-ink-muted">{new Date(d.timestamp * 1000).toLocaleTimeString()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
