import PageShell from '@/components/PageShell';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchPolicy } from '@/lib/relay';

const DAY_CAP_USD = 5.0;

function ArcGauge({ spentMicro, capMicro }: { spentMicro: string; capMicro: string }) {
  const spent = Number(spentMicro) / 1_000_000;
  const cap = Number(capMicro) / 1_000_000;
  const pct = Math.min(spent / cap, 0.9999);
  const remaining = Math.max(cap - spent, 0);

  const color = pct < 0.6 ? '#5ed29c' : pct < 0.85 ? '#f59e0b' : '#ef4444';

  // Arc geometry: semicircle, r=70, center (100, 90)
  const r = 70;
  const cx = 100;
  const cy = 90;
  const startX = cx - r; // 30
  const startY = cy;     // 90

  // Background arc: M 30 90 A 70 70 0 1 0 170 90  (CCW, large arc = full semicircle)
  const bgPath = `M ${startX} ${startY} A ${r} ${r} 0 1 0 ${cx + r} ${startY}`;

  // Foreground arc (spent portion, left→right)
  const ex = cx + r * Math.cos(Math.PI - pct * Math.PI);
  const ey = cy - r * Math.sin(pct * Math.PI);
  const fgPath = pct > 0.001
    ? `M ${startX} ${startY} A ${r} ${r} 0 0 0 ${ex} ${ey}`
    : '';

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Arc + overlay */}
      <div className="relative w-56">
        <svg viewBox="0 0 200 100" className="w-full" aria-hidden="true">
          {/* Background arc */}
          <path
            d={bgPath}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Foreground (spent) arc */}
          {fgPath && (
            <path
              d={fgPath}
              fill="none"
              stroke={color}
              strokeWidth="14"
              strokeLinecap="round"
            />
          )}
        </svg>
        {/* Center overlay text */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          <p
            className="font-[family-name:var(--font-instrument)] leading-none"
            style={{ fontSize: '2rem', color: remaining < 0.5 ? '#ef4444' : '#fff' }}
          >
            ${remaining.toFixed(2)}
          </p>
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/35 mt-0.5">
            remaining today
          </p>
        </div>
      </div>

      {/* Numeric summary */}
      <div className="flex items-center gap-10">
        <div className="text-center">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Spent</p>
          <p className="font-[family-name:var(--font-instrument)] text-2xl text-white">
            ${spent.toFixed(4)}
          </p>
        </div>
        <div className="w-px h-8 bg-white/10" aria-hidden="true" />
        <div className="text-center">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Daily cap</p>
          <p className="font-[family-name:var(--font-inter)] font-mono text-sm text-white/50">
            ${cap.toFixed(2)}
          </p>
        </div>
        <div className="w-px h-8 bg-white/10" aria-hidden="true" />
        <div className="text-center">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Used</p>
          <p className="font-[family-name:var(--font-inter)] font-mono text-sm" style={{ color }}>
            {(pct * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      <p className="font-[family-name:var(--font-inter)] text-xs text-white/25 text-center">
        Resets at midnight UTC
      </p>
    </div>
  );
}

export default async function PolicyPage() {
  const result = await fetchPolicy();

  return (
    <PageShell
      title="Policy engine"
      subtitle="The APEX $5.00/day spend budget. Every denial is logged. The guard is mechanical, not advisory."
    >
      <div className="flex flex-col gap-8">

        {/* Live gauge */}
        {!result.ok ? (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-8">
            <p className="font-[family-name:var(--font-inter)] text-sm font-medium text-white/40 mb-4">
              Today&apos;s spend
            </p>
            <RelayOffline endpoint="http://localhost:3402/api/policy" reason={result.reason} />
          </div>
        ) : (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-8">
            <p className="font-[family-name:var(--font-inter)] text-sm font-medium text-white/40 mb-6 text-center">
              {result.data.date}
            </p>
            <ArcGauge
              spentMicro={result.data.spentMicroUsdc}
              capMicro={result.data.dailyCapMicroUsdc}
            />
          </div>
        )}

        {/* Rules */}
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-5">
          <h2 className="font-[family-name:var(--font-inter)] text-sm font-semibold text-white/40 mb-5">
            Enforcement rules
          </h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['Daily cap', `$${DAY_CAP_USD.toFixed(2)} USDC per UTC day`],
              ['Enforcement', 'canSpend() checked before every transfer'],
              ['Persistence', 'data/spend-ledger.json — survives restarts'],
              ['Reset', 'Midnight UTC — date checked on each load'],
              ['Over-spend protection', 'Spend recorded before receipt replay'],
              ['Network', 'solana-devnet only in simulator mode'],
            ].map(([key, val]) => (
              <div key={key as string} className="flex flex-col gap-1">
                <dt className="font-[family-name:var(--font-inter)] text-[10px] text-white/30">{key}</dt>
                <dd className="font-[family-name:var(--font-inter)] text-sm text-white/65">{val}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Denial log */}
        {result.ok && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/8">
              <h2 className="font-[family-name:var(--font-inter)] text-sm font-semibold text-white/40">
                Denial log —{' '}
                <span className={result.data.denials.length > 0 ? 'text-red-400' : 'text-white/40'}>
                  {result.data.denials.length} denial{result.data.denials.length !== 1 ? 's' : ''} today
                </span>
              </h2>
            </div>
            {result.data.denials.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="font-[family-name:var(--font-inter)] text-sm text-white/25">
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
                        <p className="font-mono text-[10px] text-white/25 truncate max-w-xs">
                          {d.deviceId}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-5 shrink-0">
                      <div className="text-right">
                        <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/25">Amount</p>
                        <p className="font-mono text-xs text-white/50">
                          ${(Number(d.amount) / 1_000_000).toFixed(6)}
                        </p>
                      </div>
                      <p className="font-mono text-[10px] text-white/25">
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
