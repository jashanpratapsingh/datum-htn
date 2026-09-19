import PageShell from '@/components/PageShell';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchDevice } from '@/lib/relay';

const REASON_NAMES: Record<string, string> = {
  '0': 'power-on',
  '1': 'reset pin',
  '3': 'SW reset',
  '5': 'deep-sleep wakeup',
  '6': 'panic',
  '7': 'int watchdog',
  '8': 'task watchdog',
  '11': 'deep-sleep',
  '12': 'GPIO wakeup',
  '14': 'ULP wakeup',
};

function Stat({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-0.5">{label}</p>
      <p className={`font-[family-name:var(--font-inter)] text-sm text-white/80 ${mono ? 'font-mono' : ''}`}>
        {value ?? '—'}
      </p>
    </div>
  );
}

function ResetHistogram({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return <p className="text-xs text-white/30 font-[family-name:var(--font-inter)]">No reset data</p>;

  const maxCount = Math.max(...entries.map(([, n]) => n));
  const barW = 36;
  const barGap = 12;
  const chartH = 80;
  const labelH = 28;
  const topPad = 20;
  const svgW = entries.length * (barW + barGap) - barGap;
  const svgH = chartH + labelH + topPad;

  // Opacity-stepped greens
  const fillAt = (i: number) => `rgba(94, 210, 156, ${Math.max(0.9 - i * 0.14, 0.2)})`;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <svg
          viewBox={`-4 0 ${svgW + 8} ${svgH}`}
          className="w-full min-w-[200px] overflow-visible"
          aria-label="Reset reason histogram"
          role="img"
        >
          {/* Baseline */}
          <line
            x1={0} y1={chartH + topPad}
            x2={svgW} y2={chartH + topPad}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />

          {entries.map(([reason, count], i) => {
            const x = i * (barW + barGap);
            const barH = maxCount > 0 ? (count / maxCount) * chartH : 0;
            const y = chartH + topPad - barH;
            const fill = fillAt(i);

            return (
              <g key={reason}>
                {/* Count above bar */}
                <text
                  x={x + barW / 2}
                  y={y - 5}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.45)"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {count}
                </text>
                {/* Bar */}
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  fill={fill}
                  rx={4}
                >
                  <title>Reason {reason} ({REASON_NAMES[reason] ?? 'unknown'}): {count} × ({Math.round((count / total) * 100)}%)</title>
                </rect>
                {/* Reason code label */}
                <text
                  x={x + barW / 2}
                  y={chartH + topPad + 16}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.35)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  #{reason}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {entries.map(([reason, count], i) => (
          <div key={reason} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: fillAt(i) }}
              aria-hidden="true"
            />
            <span className="font-[family-name:var(--font-inter)] text-[10px] text-white/40">
              #{reason} {REASON_NAMES[reason] ?? `reason ${reason}`} ×{count}
            </span>
          </div>
        ))}
      </div>

      <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/25">
        {total} total resets across {entries.length} distinct reason{entries.length !== 1 ? 's' : ''}.
        Reason #11 (deep-sleep) is normal for badge operation.
      </p>
    </div>
  );
}

function HeapGauge({ free, largest }: { free: number; largest: number }) {
  const total = 327_680;
  const freePct = Math.min((free / total) * 100, 100);
  const color = freePct > 30 ? '#5ed29c' : freePct > 15 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-4 mb-1">
        <p className="font-[family-name:var(--font-instrument)] text-4xl text-white leading-none">
          {Math.round(free / 1024)}
          <span className="font-[family-name:var(--font-inter)] text-lg text-white/40 ml-1">KB</span>
        </p>
        <p className="font-[family-name:var(--font-inter)] text-xs text-white/30 pb-1">
          free of {Math.round(total / 1024)}KB total
        </p>
      </div>

      <div
        className="relative h-2.5 rounded-full overflow-hidden"
        style={{ backgroundColor: 'rgba(255,255,255,0.07)' }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${freePct}%`, backgroundColor: color }}
          role="progressbar"
          aria-valuenow={free}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${Math.round(free / 1024)}KB free of ${Math.round(total / 1024)}KB`}
        />
        {/* Largest contiguous block overlay */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.min((largest / total) * 100, 100)}%`,
            backgroundColor: color,
            opacity: 0.3,
          }}
          title={`Largest contiguous block: ${Math.round(largest / 1024)}KB`}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-white/30">
        <span>{freePct.toFixed(1)}% free — largest block {Math.round(largest / 1024)}KB</span>
      </div>

      {free < 40_960 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-amber-400">
            &lt;40KB free — TLS handshakes require 40–50KB contiguous.
          </p>
        </div>
      )}
    </div>
  );
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DeviceDetailPage({ params }: Props) {
  const { id } = await params;
  const result = await fetchDevice(id);

  if (!result.ok) {
    return (
      <PageShell title={decodeURIComponent(id)} subtitle="Device detail">
        <RelayOffline
          endpoint={`http://localhost:3402/api/devices/${id}`}
          reason={result.reason}
        />
      </PageShell>
    );
  }

  const device = result.data;
  const lastSeen = device.lastSeen ? new Date(device.lastSeen * 1000) : null;

  return (
    <PageShell title="Device detail" subtitle={device.id}>
      <div className="flex flex-col gap-8">

        {/* Identity header */}
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <SourceBadge source={device.source} />
              {device.chip && (
                <span className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/40 uppercase">
                  {device.chip}
                </span>
              )}
            </div>
            {lastSeen && (
              <p className="font-[family-name:var(--font-inter)] text-xs text-white/30">
                Last seen {lastSeen.toISOString()}
              </p>
            )}
          </div>
          {device.earningsMicroUsdc && (
            <div className="text-right">
              <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Lifetime earnings</p>
              <p className="font-[family-name:var(--font-instrument)] text-4xl text-[#5ed29c]">
                ${(Number(device.earningsMicroUsdc) / 1_000_000).toFixed(4)}
              </p>
            </div>
          )}
        </div>

        {/* Memory */}
        {device.freeHeap != null && device.largestBlock != null && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-5">
            <h2 className="font-[family-name:var(--font-inter)] text-sm font-semibold text-white/50 mb-5">
              Heap memory
            </h2>
            <HeapGauge free={device.freeHeap} largest={device.largestBlock} />
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Stat label="Boot count" value={device.bootCount} />
          <Stat label="Task count" value={device.taskCount} />
          <Stat
            label="LVGL heap used"
            value={device.lvglUsedPct != null ? `${device.lvglUsedPct}%` : undefined}
          />
          <Stat
            label="BLE controller state"
            value={device.bleState != null ? `0x${device.bleState.toString(16)}` : undefined}
            mono
          />
          <Stat
            label="Filesystem"
            value={device.fsBytes != null ? `${Math.round(device.fsBytes / 1024)}KB` : undefined}
          />
          {device.deviceHash && (
            <Stat
              label="Device hash"
              value={device.deviceHash.slice(0, 16) + '…'}
              mono
            />
          )}
        </div>

        {/* Reset reason histogram */}
        {device.resetReasons && Object.keys(device.resetReasons).length > 0 && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-5 py-5">
            <h2 className="font-[family-name:var(--font-inter)] text-sm font-semibold text-white/50 mb-5">
              Reset reason histogram
            </h2>
            <ResetHistogram reasons={device.resetReasons} />
          </div>
        )}

        {/* No data at all */}
        {!device.freeHeap && !device.resetReasons && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-10 text-center">
            <p className="font-[family-name:var(--font-inter)] text-sm text-white/30">
              Device registered but no telemetry received yet.
            </p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
