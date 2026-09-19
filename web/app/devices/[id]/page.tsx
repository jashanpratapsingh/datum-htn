import PageShell from '@/components/PageShell';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchDevice } from '@/lib/relay';

function Stat({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-[family-name:var(--font-inter)] text-[10px] uppercase tracking-wider text-white/30">
        {label}
      </p>
      <p
        className={`font-[family-name:var(--font-inter)] text-sm text-white/80 ${mono ? 'font-mono' : ''}`}
      >
        {value ?? '—'}
      </p>
    </div>
  );
}

function ResetReasonBar({ reasons }: { reasons: Record<string, number> }) {
  const entries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return <p className="text-xs text-white/30 font-[family-name:var(--font-inter)]">No reset data</p>;

  const palette = ['#5ed29c', '#3ba673', '#2a7a56', '#1d5940', '#0f3d2a'];

  return (
    <div className="flex flex-col gap-3">
      {/* Stacked bar */}
      <div className="h-4 rounded-full overflow-hidden flex" role="img" aria-label="Reset reason distribution">
        {entries.map(([reason, count], i) => (
          <div
            key={reason}
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: palette[i % palette.length],
              opacity: 1 - i * 0.12,
            }}
            title={`Reason ${reason}: ${count} (${Math.round((count / total) * 100)}%)`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {entries.map(([reason, count], i) => (
          <div key={reason} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: palette[i % palette.length], opacity: 1 - i * 0.12 }}
              aria-hidden="true"
            />
            <span className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/50">
              #{reason} × {count}
            </span>
          </div>
        ))}
      </div>

      <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30">
        {total} total resets. Reason 11 = deep-sleep wake (normal for badge).
      </p>
    </div>
  );
}

function HeapGauge({ free, largest }: { free: number; largest: number }) {
  const total = 327_680;
  const freePct = Math.min((free / total) * 100, 100);
  const contiguousPct = Math.min((largest / total) * 100, 100);
  const color = freePct > 30 ? '#5ed29c' : freePct > 15 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-3 rounded-full bg-white/10 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${freePct}%`, backgroundColor: color }}
          role="progressbar"
          aria-valuenow={free}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`${Math.round(free / 1024)}KB free of ${Math.round(total / 1024)}KB`}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-40"
          style={{ width: `${contiguousPct}%`, backgroundColor: color }}
          title={`Largest contiguous block: ${Math.round(largest / 1024)}KB`}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/40">
          {Math.round(free / 1024)}KB free / {Math.round(largest / 1024)}KB largest block
        </span>
        <span className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/40">
          {Math.round(total / 1024)}KB total
        </span>
      </div>
      {free < 40_960 && (
        <p className="font-[family-name:var(--font-inter)] text-[10px] text-amber-400">
          Warning: &lt;40KB free — TLS handshakes require 40–50KB contiguous.
        </p>
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
    <PageShell title="Device Detail" subtitle={device.id}>
      <div className="flex flex-col gap-8">
        {/* Identity header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <SourceBadge source={device.source} />
              {device.chip && (
                <span className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/40 uppercase">
                  {device.chip}
                </span>
              )}
            </div>
            <p className="font-[family-name:var(--font-inter)] font-mono text-base text-white break-all">
              {device.id}
            </p>
            {lastSeen && (
              <p className="font-[family-name:var(--font-inter)] text-xs text-white/30">
                Last seen: {lastSeen.toISOString()}
              </p>
            )}
          </div>
          {device.earningsMicroUsdc && (
            <div className="text-right">
              <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
                Earnings
              </p>
              <p className="font-[family-name:var(--font-inter)] font-extrabold text-2xl text-[#5ed29c]">
                ${(Number(device.earningsMicroUsdc) / 1_000_000).toFixed(4)}
              </p>
            </div>
          )}
        </div>

        {/* Memory */}
        {device.freeHeap != null && device.largestBlock != null && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
            <h2 className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Memory (with BLE radio up)
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
            label="FS size"
            value={
              device.fsBytes != null ? `${Math.round(device.fsBytes / 1024)}KB` : undefined
            }
          />
          {device.deviceHash && (
            <Stat
              label="Device hash (SHA-256 prefix)"
              value={device.deviceHash.slice(0, 16) + '…'}
              mono
            />
          )}
        </div>

        {/* Reset reasons */}
        {device.resetReasons && Object.keys(device.resetReasons).length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5">
            <h2 className="font-[family-name:var(--font-inter)] text-xs font-semibold text-white/40 uppercase tracking-wider mb-4">
              Reset reason histogram
            </h2>
            <ResetReasonBar reasons={device.resetReasons} />
          </div>
        )}
      </div>
    </PageShell>
  );
}
