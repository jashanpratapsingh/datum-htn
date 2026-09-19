import PageShell from '@/components/PageShell';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchPolicy } from '@/lib/relay';

const DAY_CAP_USD = 5.0;

function DailyGauge({ spentMicro, capMicro }: { spentMicro: string; capMicro: string }) {
  const spent = Number(spentMicro) / 1_000_000;
  const cap = Number(capMicro) / 1_000_000;
  const pct = Math.min((spent / cap) * 100, 100);
  const remaining = Math.max(cap - spent, 0);

  const barColor =
    pct < 60 ? '#5ed29c' : pct < 85 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
            Spent today
          </p>
          <p className="font-[family-name:var(--font-inter)] font-extrabold text-3xl text-white">
            ${spent.toFixed(4)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
            Remaining
          </p>
          <p
            className="font-[family-name:var(--font-inter)] font-extrabold text-3xl"
            style={{ color: remaining < 0.5 ? '#ef4444' : '#5ed29c' }}
          >
            ${remaining.toFixed(4)}
          </p>
        </div>
      </div>

      <div className="h-3 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
          role="progressbar"
          aria-valuenow={spent}
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-label={`$${spent.toFixed(4)} of $${cap.toFixed(2)} daily budget used`}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="font-[family-name:var(--font-inter)] text-xs text-white/40">
          {pct.toFixed(1)}% of ${cap.toFixed(2)}/day cap
        </p>
        <p className="font-[family-name:var(--font-inter)] text-xs text-white/30">
          Resets at midnight UTC
        </p>
      </div>
    </div>
  );
}

export default async function PolicyPage() {
  const result = await fetchPolicy();

  return (
    <PageShell
      title="Policy Engine"
      subtitle="The APEX $5.00/day spend budget. Every denial is logged. The guard is mechanical, not advisory."
    >
      <div className="flex flex-col gap-8">
        {/* Rules */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
          <h2 className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
            Rules
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ['Daily cap', `$${DAY_CAP_USD.toFixed(2)} USDC per UTC day`],
              ['Enforcement', 'canSpend() checked before every transfer'],
              ['Persistence', 'data/spend-ledger.json — survives restarts'],
              ['Reset', 'Midnight UTC — date checked on each load'],
              ['Over-spend protection', 'Spend recorded before receipt replay'],
              ['Network', 'solana-devnet only in simulator mode'],
            ].map(([key, val]) => (
              <div key={key as string} className="flex flex-col gap-0.5">
                <dt className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider">
                  {key}
                </dt>
                <dd className="font-[family-name:var(--font-inter)] text-sm text-white/70">
                  {val}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Live gauge */}
        {!result.ok ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
            <h2 className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Today&apos;s spend
            </h2>
            <RelayOffline endpoint="http://localhost:3402/api/policy" reason={result.reason} />
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
            <h2 className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Today&apos;s spend — {result.data.date}
            </h2>
            <DailyGauge
              spentMicro={result.data.spentMicroUsdc}
              capMicro={result.data.dailyCapMicroUsdc}
            />
          </div>
        )}

        {/* Denials */}
        {result.ok && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-3 border-b border-white/10">
              <h2 className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider">
                Denial log — {result.data.denials.length} denial{result.data.denials.length !== 1 ? 's' : ''} today
              </h2>
            </div>
            {result.data.denials.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="font-[family-name:var(--font-inter)] text-sm text-white/30">
                  No denials today — budget has not been exhausted.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-white/5">
                {result.data.denials.map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="flex flex-col gap-0.5">
                      <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-red-400">
                        {d.reason}
                      </p>
                      {d.deviceId && (
                        <p className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/30 truncate max-w-xs">
                          {d.deviceId}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-right">
                      <div>
                        <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30">
                          Amount
                        </p>
                        <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/50">
                          ${(Number(d.amount) / 1_000_000).toFixed(6)}
                        </p>
                      </div>
                      <p className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/30">
                        {new Date(d.timestamp * 1000).toLocaleTimeString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </PageShell>
  );
}
