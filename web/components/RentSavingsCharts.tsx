'use client';

/**
 * What ZK compression saved, reading by reading.
 *
 * Two views of the same model (`lib/rent.ts`), side by side:
 *
 *  - Per reading: for each settled reading, the rent a standard Solana account
 *    would have charged against the rent the compressed record actually costs,
 *    with a tick for what the reading sold for. Rent is per record, so every
 *    row is the same height; that sameness is the point — the saving does not
 *    depend on the price.
 *  - Running total: three lines on one axis — what standard accounts would owe
 *    so far, what the readings have earned, and what compressed storage has
 *    actually cost. The gap between the first and the last is the saving.
 *
 * Colour follows the meaning already fixed on this page: alarm for the
 * standard-account rent (the cost that would sink a node), ink for money the
 * node keeps, hatched ink for the compressed cost. Every series is also named
 * in a legend and labelled at its end, and the receipt below is the table view,
 * so nothing here depends on colour alone.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { ratio, type SavingsPoint, type SavingsSummary } from '@/lib/rent';
import { formatUsdc } from '@/lib/usdc';

const MAX_ROWS = 12;

/* ------------------------------------------------------------------ *
   Shared bits.
 * ------------------------------------------------------------------ */

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

function tick(v: number): string {
  if (v === 0) return '0';
  return v.toFixed(6).replace(/\.?0+$/, '');
}

const HATCH = 'repeating-linear-gradient(135deg, var(--color-ink) 0 2px, var(--color-canvas-lift) 2px 5px)';

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString('en-US', { hour12: false });
const stamp = (t: number) =>
  new Date(t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function Swatch({ kind }: { kind: 'alarm' | 'ink' | 'hatch' | 'dash' | 'tick' }) {
  if (kind === 'tick') return <span aria-hidden="true" className="inline-block h-3 w-[2px] bg-ink align-[-1px]" />;
  if (kind === 'dash')
    return (
      <span
        aria-hidden="true"
        className="inline-block h-[2px] w-3.5 align-middle"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--color-ink) 0 4px, transparent 4px 7px)' }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 rounded-[2px] align-[-1px] ${kind === 'alarm' ? 'bg-alarm' : kind === 'ink' ? 'bg-ink' : ''}`}
      style={kind === 'hatch' ? { backgroundImage: HATCH } : undefined}
    />
  );
}

function Legend({ items }: { items: { kind: 'alarm' | 'ink' | 'hatch' | 'dash' | 'tick'; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="plate flex items-center gap-1.5">
          <Swatch kind={i.kind} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** The card that answers a hover or a focus. Positioned by the caller. */
function Tip({ p, running, style }: { p: SavingsPoint; running: boolean; style: React.CSSProperties }) {
  return (
    <div
      role="tooltip"
      className="paper readout pointer-events-none absolute z-10 w-[15.5rem] px-3 py-2.5 text-[12px] leading-relaxed text-ink shadow-[0_1px_2px_rgba(20,20,20,0.08),0_8px_24px_rgba(20,20,20,0.10)]"
      style={style}
    >
      <div className="mb-1.5 flex justify-between text-ink-muted">
        <span>reading #{p.index}</span>
        <span>{clock(p.timestamp)}</span>
      </div>
      <Row k="sold for" v={formatUsdc(running ? p.cumRevenue : p.price)} />
      <Row k="standard account rent" v={formatUsdc(running ? p.cumStandard : p.standard)} swatch="alarm" />
      <Row k="compressed rent" v={formatUsdc(running ? p.cumCompressed : p.compressed)} swatch="hatch" />
      <div className="mt-1.5 flex justify-between border-t border-dotted border-ink-muted/40 pt-1.5">
        <span>{running ? 'saved so far' : 'saved'}</span>
        <span>{formatUsdc(running ? p.cumSaved : p.saved)} USDC</span>
      </div>
    </div>
  );
}

function Row({ k, v, swatch }: { k: string; v: string; swatch?: 'alarm' | 'hatch' }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="flex items-center gap-1.5 text-ink-muted">
        {swatch && <Swatch kind={swatch} />}
        {k}
      </span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Per reading: two thin bars a row, a tick for the sale.
 * ------------------------------------------------------------------ */

const COLS = 'grid grid-cols-[5.25rem_1fr_4.75rem] items-center gap-x-3 sm:grid-cols-[6.5rem_1fr_5.25rem]';

function PerReading({ s }: { s: SavingsSummary }) {
  const rows = s.points.slice(-MAX_ROWS);
  const max = niceCeil(Math.max(...rows.map((p) => Math.max(p.standard, p.price)), 1e-6));
  const stops = [0, 0.5, 1];
  const [hover, setHover] = useState<{ p: SavingsPoint; y: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  function show(p: SavingsPoint, el: HTMLElement) {
    const host = listRef.current?.getBoundingClientRect();
    const me = el.getBoundingClientRect();
    setHover({ p, y: host ? me.bottom - host.top + 6 : 0 });
  }

  return (
    <div className="px-4 pb-4 pt-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-[15px] text-ink">Per reading</h3>
          <p className="plate mt-0.5">
            Rent one record costs, each way it can be kept
            {s.count > MAX_ROWS ? ` · latest ${MAX_ROWS} of ${s.count}` : ''}
          </p>
        </div>
        <Legend
          items={[
            { kind: 'alarm', label: 'standard account rent' },
            { kind: 'hatch', label: 'compressed rent' },
            { kind: 'tick', label: 'sold for' },
          ]}
        />
      </div>

      <div className="relative">
        <ol ref={listRef} data-testid="rent-rows" className="relative">
          {rows.map((p) => {
            const stdW = Math.min(100, (p.standard / max) * 100);
            const cmpW = Math.min(100, (p.compressed / max) * 100);
            const saleX = Math.min(100, (p.price / max) * 100);
            return (
              <li
                key={p.key}
                tabIndex={0}
                data-testid="rent-row"
                aria-label={`Reading ${p.index} at ${clock(p.timestamp)}: sold for ${formatUsdc(p.price)} USDC; a standard account would cost ${formatUsdc(
                  p.standard,
                )} of rent, compressed costs ${formatUsdc(p.compressed)}; saved ${formatUsdc(p.saved)}.`}
                className={`${COLS} rounded-[6px] py-2 outline-none transition-colors hover:bg-canvas/60 focus-visible:bg-canvas/60`}
                onPointerEnter={(e) => show(p, e.currentTarget)}
                onPointerLeave={() => setHover(null)}
                onFocus={(e) => show(p, e.currentTarget)}
                onBlur={() => setHover(null)}
              >
                <span className="readout min-w-0 text-[12px] leading-tight text-ink">
                  <span className="block">#{p.index}</span>
                  <span className="block truncate text-[11px] text-ink-muted">{clock(p.timestamp)}</span>
                </span>

                <div className="relative" aria-hidden="true">
                  {stops.map((f) => (
                    <span
                      key={f}
                      className="absolute -inset-y-2 w-px bg-rule"
                      style={{ left: `${f * 100}%`, transform: f === 1 ? 'translateX(-1px)' : undefined }}
                    />
                  ))}
                  <div className="relative h-[10px]">
                    <div
                      className="absolute inset-y-0 left-0 flex items-center justify-end overflow-hidden rounded-r-[4px] bg-alarm pr-1.5"
                      style={{ width: `${stdW}%`, minWidth: 3 }}
                    >
                      {stdW > 30 && (
                        <span className="readout text-[9px] leading-none text-pill">{formatUsdc(p.standard)}</span>
                      )}
                    </div>
                  </div>
                  <div className="relative mt-[2px] h-[10px]">
                    <div
                      className="absolute inset-y-0 left-0 rounded-r-[2px]"
                      style={{ width: `${cmpW}%`, minWidth: 3, backgroundImage: HATCH }}
                    />
                    <span
                      className="readout absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] leading-none text-ink-muted"
                      style={{ left: `calc(max(${cmpW}%, 3px, ${saleX}% + 3px) + 6px)` }}
                    >
                      {formatUsdc(p.compressed)}
                    </span>
                  </div>
                  {p.price > 0 && (
                    <span
                      className="absolute -top-[3px] -bottom-[3px] w-[2px] -translate-x-1/2 bg-ink"
                      style={{ left: `${saleX}%` }}
                    />
                  )}
                </div>

                <span className="readout text-right text-[13px] leading-tight text-ink">
                  <span className="block">{formatUsdc(p.saved)}</span>
                  <span className="block text-[11px] text-ink-muted">saved</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className={`${COLS} mt-2`} aria-hidden="true">
          <span />
          <div className="relative h-4">
            {stops.map((f) => (
              <span
                key={f}
                className="plate absolute top-0 text-[11px]"
                style={{
                  left: `${f * 100}%`,
                  transform: f === 0 ? undefined : f === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                {tick(f * max)}
              </span>
            ))}
          </div>
          <span className="plate text-right text-[11px]">USDC</span>
        </div>

        {hover && <Tip p={hover.p} running={false} style={{ left: '5.5rem', top: hover.y }} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   Running total: three lines, one axis, labelled at the end.
 * ------------------------------------------------------------------ */

type Series = { id: 'standard' | 'revenue' | 'compressed'; label: string; color: string; dash?: string; value: (p: SavingsPoint) => number };

const SERIES: Series[] = [
  { id: 'standard', label: 'standard accounts would owe', color: 'var(--color-alarm)', value: (p) => p.cumStandard },
  { id: 'revenue', label: 'readings earned', color: 'var(--color-ink)', value: (p) => p.cumRevenue },
  { id: 'compressed', label: 'compressed actually cost', color: 'var(--color-ink)', dash: '4 3', value: (p) => p.cumCompressed },
];

const PLOT_H = 190;
/** Below this width the end labels stack value over name so the plot keeps room to breathe. */
const NARROW = 480;

/** Push end labels apart so none overlap, keeping them inside the plot. */
function spread(ys: number[], top: number, bottom: number, gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = order.map((o) => o.y);
  for (let k = 1; k < out.length; k++) if (out[k] - out[k - 1] < gap) out[k] = out[k - 1] + gap;
  const over = out[out.length - 1] - bottom;
  if (over > 0) for (let k = 0; k < out.length; k++) out[k] -= over;
  for (let k = 0; k < out.length; k++) out[k] = Math.max(top, out[k]);
  for (let k = 1; k < out.length; k++) if (out[k] - out[k - 1] < gap) out[k] = out[k - 1] + gap;
  const result = new Array<number>(ys.length);
  order.forEach((o, k) => (result[o.i] = out[k]));
  return result;
}

function RunningTotal({ s }: { s: SavingsSummary }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = s.points;
  const n = pts.length;
  const W = width;
  const narrow = W < NARROW;
  const M = narrow ? { top: 14, right: 88, bottom: 26, left: 46 } : { top: 14, right: 132, bottom: 26, left: 56 };
  const labelGap = narrow ? 26 : 15;
  const H = M.top + PLOT_H + M.bottom;
  const x0 = M.left;
  const x1 = W - M.right;
  const y0 = M.top;
  const y1 = M.top + PLOT_H;

  const yMax = niceCeil(Math.max(pts[n - 1]?.cumStandard ?? 0, 1e-6));
  const t0 = pts[0]?.timestamp ?? 0;
  const t1 = pts[n - 1]?.timestamp ?? 0;
  const xOf = (i: number) => {
    if (n <= 1 || t1 === t0) return n <= 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
    return x0 + ((pts[i].timestamp - t0) / (t1 - t0)) * (x1 - x0);
  };
  const yOf = (v: number) => y1 - (v / yMax) * (y1 - y0);

  const grid = [0, 0.5, 1].map((f) => ({ y: yOf(f * yMax), label: tick(f * yMax) }));
  const last = pts[n - 1];
  const endYs = spread(
    SERIES.map((sr) => yOf(sr.value(last))),
    y0 + 6,
    y1 - (narrow ? 12 : 2),
    labelGap,
  );

  function nearest(clientX: number): number {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return n - 1;
    const x = clientX - rect.left;
    let best = 0;
    let d = Infinity;
    for (let i = 0; i < n; i++) {
      const di = Math.abs(xOf(i) - x);
      if (di < d) {
        d = di;
        best = i;
      }
    }
    return best;
  }

  function onKey(e: React.KeyboardEvent) {
    const cur = active ?? n - 1;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  }

  const a = active !== null ? pts[active] : null;
  const tipLeft = a ? Math.min(Math.max(xOf(active!) + 12, 0), W - 260) : 0;

  return (
    <div className="px-4 pb-4 pt-4">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-[15px] text-ink">Running total</h3>
          <p className="plate mt-0.5">What the ledger would owe in rent, against what it has earned</p>
        </div>
        <Legend
          items={[
            { kind: 'alarm', label: 'standard accounts would owe' },
            { kind: 'ink', label: 'readings earned' },
            { kind: 'dash', label: 'compressed actually cost' },
          ]}
        />
      </div>

      <div ref={wrapRef} className="relative">
        <svg
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          height={H}
          role="img"
          aria-describedby={descId}
          aria-label="Running totals of rent and revenue across settled readings"
          tabIndex={0}
          data-testid="rent-lines"
          className="block touch-none select-none overflow-visible rounded-[4px]"
          onPointerMove={(e) => setActive(nearest(e.clientX))}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          <desc id={descId}>
            After {n} settled reading{n === 1 ? '' : 's'}: standard accounts would owe {formatUsdc(s.standard)} USDC of rent, the readings earned{' '}
            {formatUsdc(s.revenue)}, compressed storage cost {formatUsdc(s.compressed)}. Saved {formatUsdc(s.saved)}.
          </desc>

          {grid.map((g) => (
            <g key={g.label}>
              <line x1={x0} x2={x1} y1={g.y} y2={g.y} stroke="var(--color-rule)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={x0 - 8} y={g.y + 3.5} textAnchor="end" className="readout" fontSize={11} fill="var(--color-ink-muted)">
                {g.label}
              </text>
            </g>
          ))}

          {n > 1 && (
            <>
              <text x={x0} y={y1 + 18} className="readout" fontSize={11} fill="var(--color-ink-muted)">
                {stamp(t0)}
              </text>
              <text x={x1} y={y1 + 18} textAnchor="end" className="readout" fontSize={11} fill="var(--color-ink-muted)">
                {stamp(t1)}
              </text>
            </>
          )}
          {n === 1 && (
            <text x={(x0 + x1) / 2} y={y1 + 18} textAnchor="middle" className="readout" fontSize={11} fill="var(--color-ink-muted)">
              {stamp(t0)}
            </text>
          )}

          {SERIES.map((sr, k) => {
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(sr.value(p)).toFixed(1)}`).join(' ');
            const ex = xOf(n - 1);
            const ey = yOf(sr.value(last));
            const ly = endYs[k];
            return (
              <g key={sr.id} data-testid={`rent-line-${sr.id}`}>
                {n > 1 && (
                  <path d={d} fill="none" stroke={sr.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={sr.dash} />
                )}
                {Math.abs(ly - ey) > 2 && (
                  <line x1={ex + 6} y1={ey} x2={ex + 14} y2={ly} stroke="var(--color-rule)" strokeWidth={1} />
                )}
                <circle cx={ex} cy={ey} r={4} fill={sr.color} stroke="var(--color-canvas-lift)" strokeWidth={2} />
                <text x={ex + 18} y={ly + (narrow ? -2 : 3.5)} className="readout" fontSize={11} fill="var(--color-ink)">
                  {formatUsdc(sr.value(last))}
                  <tspan
                    fill="var(--color-ink-muted)"
                    x={narrow ? ex + 18 : undefined}
                    dy={narrow ? 12 : undefined}
                  >
                    {narrow ? '' : ' '}
                    {sr.id === 'standard' ? 'standard' : sr.id === 'revenue' ? 'earned' : 'compressed'}
                  </tspan>
                </text>
              </g>
            );
          })}

          {a && (
            <g aria-hidden="true">
              <line x1={xOf(active!)} x2={xOf(active!)} y1={y0} y2={y1} stroke="var(--color-ink)" strokeWidth={1} strokeOpacity={0.35} />
              {SERIES.map((sr) => (
                <circle key={sr.id} cx={xOf(active!)} cy={yOf(sr.value(a))} r={4} fill={sr.color} stroke="var(--color-canvas-lift)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>

        {a && <Tip p={a} running style={{ left: tipLeft, top: M.top }} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
   The panel body: both charts, a hairline between.
 * ------------------------------------------------------------------ */

export default function RentSavingsCharts({ summary }: { summary: SavingsSummary }) {
  if (summary.count === 0) return null;
  return (
    <div data-testid="rent-charts" className="grid grid-cols-1 lg:grid-cols-2">
      <PerReading s={summary} />
      <div className="panel-divide lg:panel-divide-x lg:border-t-0">
        <RunningTotal s={summary} />
      </div>
      <p className="panel-divide plate px-4 py-3 leading-relaxed lg:col-span-2">
        Rent is charged per record, not per sale, so every reading saves the same {formatUsdc(summary.points[0].saved)} USDC however
        little it sold for. Standard accounts would have cost {ratio(summary.standardOverRevenue)} what these readings earned;
        compressed storage cost {ratio(summary.compressedOverRevenue)}.
      </p>
    </div>
  );
}
