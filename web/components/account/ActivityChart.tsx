import type { ReadingPoint } from '@/lib/dashboard';

/**
 * Activity over the last 24 h, one small chart per device (small multiples,
 * never a dual axis). Single series per chart, so no legend: the title names
 * it. Ink line, 2 px; points ≥ 8 px hit targets with a native tooltip; a gap
 * longer than 30 min breaks the line rather than pretending continuity.
 */

const W = 640;
const H = 150;
const PAD = { l: 34, r: 12, t: 14, b: 24 };
const GAP_MS = 30 * 60_000;

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function DeviceChart({ device, source, points, now }: { device: string; source: string; points: ReadingPoint[]; now: number }) {
  const start = now - 24 * 3_600_000;
  const xs = (t: number) => PAD.l + ((t - start) / (now - start)) * (W - PAD.l - PAD.r);
  const vals = points.map((p) => p.value);
  const vmax = Math.max(1, ...vals);
  const vmin = Math.min(0, ...vals);
  const ys = (v: number) => PAD.t + (1 - (v - vmin) / (vmax - vmin || 1)) * (H - PAD.t - PAD.b);

  // Break the path where readings are far apart.
  const segments: string[] = [];
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const cmd = !prev || p.at - prev.at > GAP_MS ? 'M' : 'L';
    if (cmd === 'M' && d) {
      segments.push(d);
      d = '';
    }
    d += `${cmd}${xs(p.at).toFixed(1)} ${ys(p.value).toFixed(1)} `;
  }
  if (d) segments.push(d);

  const last = points[points.length - 1];
  const ticks = [0, 6, 12, 18, 24].map((h) => start + h * 3_600_000);
  const yTicks = [vmin, (vmin + vmax) / 2, vmax];

  return (
    <figure className="px-4 py-4 [&+&]:border-t [&+&]:border-rule" data-chart={device}>
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] text-ink">
          {device} <span className="readout text-xs text-ink-muted">· {source} · {points.length} reading{points.length === 1 ? '' : 's'}</span>
        </span>
        {last && (
          <span className="readout text-sm text-ink">
            {last.value} <span className="text-xs text-ink-muted">{last.metric} · {fmtTime(last.at)}</span>
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${device}: activity over the last 24 hours, ${points.length} readings`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={ys(v)} y2={ys(v)} stroke="var(--color-rule)" strokeWidth="1" />
            <text x={PAD.l - 6} y={ys(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-ink-muted)" className="readout">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={xs(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-ink-muted)" className="readout">
            {fmtTime(t)}
          </text>
        ))}
        {segments.map((seg, i) => (
          <path key={i} d={seg} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {points.map((p) => (
          <g key={p.at + p.device}>
            <circle cx={xs(p.at)} cy={ys(p.value)} r="8" fill="transparent" />
            <circle cx={xs(p.at)} cy={ys(p.value)} r="3" fill="var(--color-canvas-lift)" stroke="var(--color-ink)" strokeWidth="2">
              <title>{`${fmtTime(p.at)} · ${p.value} ${p.metric} · ${p.source}`}</title>
            </circle>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export default function ActivityChart({ readings, now = Date.now() }: { readings: ReadingPoint[]; now?: number }) {
  const byDevice = new Map<string, ReadingPoint[]>();
  for (const r of readings) {
    const key = `${r.relayId.slice(0, 8)}:${r.device}`;
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key)!.push(r);
  }
  if (byDevice.size === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="readout mb-1 text-sm text-ink-muted">No charted readings in the last 24 hours.</p>
        <p className="text-xs text-ink-muted/70">Activity appears here once an agent buys from a device that reports foot traffic or BLE activity.</p>
      </div>
    );
  }
  return (
    <div>
      {[...byDevice.entries()].map(([key, pts]) => (
        <DeviceChart key={key} device={pts[0].device} source={pts[0].source} points={pts} now={now} />
      ))}
    </div>
  );
}
