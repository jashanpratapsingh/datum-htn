import PageShell from '@/components/PageShell';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { Sparkline } from '@/components/Sparkline';
import { fetchDevices } from '@/lib/relay';
import type { DeviceEntry } from '@/lib/relay';
import { ChevronRight, Wifi } from 'lucide-react';

function heapPercent(free: number | undefined, total = 327_680): number {
  if (!free) return 0;
  return Math.round((free / total) * 100);
}

function HeapBar({ free, largest }: { free?: number; largest?: number }) {
  const pct = heapPercent(free);
  const color = pct > 50 ? '#5ed29c' : pct > 25 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/40">
        {free != null ? `${Math.round(free / 1024)}KB` : '—'}
        {largest != null ? ` / ${Math.round(largest / 1024)}KB` : ''}
      </span>
    </div>
  );
}

function DeviceCard({ device }: { device: DeviceEntry }) {
  const boots = device.bootCount ?? 0;
  const reasons = device.resetReasons
    ? Object.entries(device.resetReasons).sort((a, b) => b[1] - a[1])
    : [];
  const topReset = reasons[0];
  const lastSeen = device.lastSeen ? new Date(device.lastSeen * 1000) : null;

  // Fake sparkline from bootCount + random seed (no invented data, just structural)
  const sparkData: number[] = [];

  return (
    <a
      href={`/devices/${encodeURIComponent(device.id)}`}
      className="group flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5 hover:border-white/20 hover:bg-white/[0.04] transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <SourceBadge source={device.source} />
            {device.chip && (
              <span className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 font-mono uppercase">
                {device.chip}
              </span>
            )}
          </div>
          <p className="font-[family-name:var(--font-inter)] font-semibold text-sm text-white font-mono break-all">
            {device.id}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sparkData.length > 1 && <Sparkline data={sparkData} width={60} height={20} />}
          <ChevronRight
            size={14}
            className="text-white/30 group-hover:text-[#5ed29c] transition-colors"
            aria-hidden="true"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-white/5 pt-4">
        <div>
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
            Free heap
          </p>
          <HeapBar free={device.freeHeap} largest={device.largestBlock} />
        </div>

        <div>
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
            Boot count
          </p>
          <p className="font-[family-name:var(--font-inter)] font-mono text-sm text-white/70">
            {boots}
          </p>
        </div>

        <div>
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
            Top reset reason
          </p>
          <p className="font-[family-name:var(--font-inter)] font-mono text-sm text-white/70">
            {topReset ? `#${topReset[0]} × ${topReset[1]}` : '—'}
          </p>
        </div>

        <div>
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
            Last seen
          </p>
          <p className="font-[family-name:var(--font-inter)] text-xs text-white/50">
            {lastSeen ? lastSeen.toLocaleTimeString() : '—'}
          </p>
        </div>
      </div>
    </a>
  );
}

export default async function DevicesPage() {
  const result = await fetchDevices();

  return (
    <PageShell
      title="Device Fleet"
      subtitle="Every vending node. Source label is authoritative — badge means a real ESP32-C3 is attached."
    >
      {!result.ok ? (
        <RelayOffline endpoint="http://localhost:3402/api/devices" reason={result.reason} />
      ) : result.data.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
          <Wifi size={24} className="text-white/20 mx-auto mb-3" aria-hidden="true" />
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/40">
            No devices registered yet. Run the relay-proxy to register a device.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-[family-name:var(--font-inter)] text-xs text-white/40">
              {result.data.length} device{result.data.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-3">
              <SourceBadge source="badge" />
              <span className="font-[family-name:var(--font-inter)] text-[10px] text-white/30">
                =&nbsp;real hardware
              </span>
              <SourceBadge source="simulator" />
              <span className="font-[family-name:var(--font-inter)] text-[10px] text-white/30">
                =&nbsp;software mock
              </span>
            </div>
          </div>
          {result.data.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
      )}
    </PageShell>
  );
}
