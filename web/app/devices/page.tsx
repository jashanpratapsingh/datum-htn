import PageShell from '@/components/PageShell';
import { Panel } from '@/components/Panel';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchDevices } from '@/lib/relay';
import type { DeviceEntry } from '@/lib/relay';

const HEAP_TOTAL = 327_680;

function HeapBar({ free, largest }: { free?: number; largest?: number }) {
  const pct = free ? Math.round((free / HEAP_TOTAL) * 100) : 0;
  // Heap is not money, so it never goes amber — it dims, then alarms.
  const tone = pct > 30 ? 'bg-phosphor' : pct > 15 ? 'bg-phosphor-dim' : 'bg-alarm';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-20 overflow-hidden bg-rule">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="readout text-[11px] text-phosphor-dim">
        {free != null ? `${Math.round(free / 1024)}K` : '—'}
        {largest != null ? ` / ${Math.round(largest / 1024)}K` : ''}
      </span>
    </div>
  );
}

function DeviceRow({ device }: { device: DeviceEntry }) {
  const reasons = device.resetReasons
    ? Object.entries(device.resetReasons).sort((a, b) => b[1] - a[1])
    : [];
  const topReset = reasons[0];
  const lastSeen = device.lastSeen ? new Date(device.lastSeen * 1000) : null;
  const earned = Number(device.earningsMicroUsdc ?? '0') / 1e6;

  return (
    <a
      href={`/devices/${encodeURIComponent(device.id)}`}
      className="group block panel-divide px-4 py-4 transition-colors hover:bg-glass-deep"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <SourceBadge source={device.source} />
            {device.chip && <span className="plate">{device.chip}</span>}
          </div>
          <p className="readout truncate text-sm text-phosphor group-hover:bloom">{device.id}</p>
        </div>
        <div className="text-right">
          <div className="plate mb-1">earned</div>
          <div className="readout bloom-amber text-xl leading-none text-amber">
            {earned.toFixed(4)}
            <span className="ml-1 text-[0.5em] text-phosphor-dim">USDC</span>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-3 md:grid-cols-4">
        <div>
          <dt className="plate mb-1">free heap</dt>
          <dd><HeapBar free={device.freeHeap} largest={device.largestBlock} /></dd>
        </div>
        <div>
          <dt className="plate mb-1">boots</dt>
          <dd className="readout text-sm text-phosphor/80">{device.bootCount ?? '—'}</dd>
        </div>
        <div>
          <dt className="plate mb-1">top reset</dt>
          <dd className="readout text-sm text-phosphor/80">
            {topReset ? `#${topReset[0]} ×${topReset[1]}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="plate mb-1">last seen</dt>
          <dd className="readout text-sm text-phosphor/80">
            {lastSeen ? lastSeen.toLocaleTimeString() : '—'}
          </dd>
        </div>
      </dl>
    </a>
  );
}

export default async function DevicesPage() {
  const result = await fetchDevices();
  const count = result.ok ? result.data.length : 0;

  return (
    <PageShell
      title="Device fleet"
      subtitle="Every vending node. The provenance stamp is authoritative: badge means a real ESP32-C3 is attached."
      stamp={result.ok ? `${count} online` : 'no link'}
    >
      {!result.ok ? (
        <RelayOffline path="/api/devices" reason={result.reason} />
      ) : result.data.length === 0 ? (
        <Panel label="Fleet">
          <p className="readout px-4 py-12 text-center text-sm text-phosphor-dim">
            No devices registered. Start relay-proxy to register one.
          </p>
        </Panel>
      ) : (
        <Panel label="Fleet" live stamp={
          <span className="flex items-center gap-3">
            <SourceBadge source="badge" />
            <span className="normal-case tracking-normal">= real hardware</span>
            <SourceBadge source="simulator" />
            <span className="normal-case tracking-normal">= software mock</span>
          </span>
        }>
          {result.data.map((d) => <DeviceRow key={d.id} device={d} />)}
        </Panel>
      )}
    </PageShell>
  );
}
