import type { SaleView } from '@/lib/dashboard';

/**
 * Spend per hour over the last 24 h as thin ink bars with rounded data-ends,
 * 2 px gaps, a native tooltip per bar. One series, no legend.
 */
const W = 640;
const H = 110;
const PAD = { l: 44, r: 12, t: 10, b: 22 };

export default function SpendChart({ sales, now = Date.now() }: { sales: SaleView[]; now?: number }) {
  const start = now - 24 * 3_600_000;
  const buckets = new Array<number>(24).fill(0);
  const counts = new Array<number>(24).fill(0);
  for (const s of sales) {
    const t = Date.parse(s.settledAt);
    if (t < start || t > now) continue;
    const i = Math.min(23, Math.floor((t - start) / 3_600_000));
    buckets[i] += s.amountMicro;
    counts[i] += 1;
  }
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="readout text-sm text-ink-muted">Nothing spent in the last 24 hours.</p>
      </div>
    );
  }
  const max = Math.max(...buckets);
  const bw = (W - PAD.l - PAD.r) / 24;
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const fmt = (micro: number) => (micro / 1e6).toFixed(4);
  return (
    <figure className="px-4 py-4">
      <figcaption className="mb-2 flex items-baseline justify-between">
        <span className="text-[15px] text-ink">
          Spend per hour <span className="readout text-xs text-ink-muted">· last 24 h</span>
        </span>
        <span className="readout text-sm text-ink">
          {fmt(total)} <span className="text-xs text-ink-muted">USDC</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`USDC spent per hour, ${fmt(total)} USDC in the last 24 hours`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--color-rule)" />
        <text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" fontSize="10" fill="var(--color-ink-muted)" className="readout">
          {fmt(max)}
        </text>
        {buckets.map((v, i) => {
          const x = PAD.l + i * bw + 1;
          const top = v ? y(v) : H - PAD.b;
          const h = Math.max(0, H - PAD.b - top);
          const hourStart = new Date(start + i * 3_600_000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          return (
            <g key={i}>
              <rect x={x} y={PAD.t} width={Math.max(1, bw - 2)} height={H - PAD.t - PAD.b} fill="transparent">
                <title>{`${hourStart} · ${fmt(v)} USDC · ${counts[i]} reading${counts[i] === 1 ? '' : 's'}`}</title>
              </rect>
              {v > 0 && <rect x={x} y={top} width={Math.max(1, bw - 2)} height={h} rx="2" fill="var(--color-ink)" />}
            </g>
          );
        })}
        {[0, 6, 12, 18, 24].map((hh) => (
          <text key={hh} x={PAD.l + (hh / 24) * (W - PAD.l - PAD.r)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-ink-muted)" className="readout">
            {new Date(start + hh * 3_600_000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </text>
        ))}
      </svg>
    </figure>
  );
}
