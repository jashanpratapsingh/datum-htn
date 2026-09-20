import PageShell from '@/components/PageShell';
import { Panel } from '@/components/Panel';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { RelayTag, RelayDark } from '@/components/RelayTag';
import { fetchDevices, deviceHref, RELAYS, MULTI_RELAY } from '@/lib/relay';
import type { DeviceEntry } from '@/lib/relay';

const HEAP_TOTAL = 327_680;

function HeapBar({ free, largest }: { free?: number; largest?: number }) {
  const pct = free ? Math.round((free / HEAP_TOTAL) * 100) : 0;
  // Heap is not money, so it never goes amber — it dims, then alarms.
  const tone = pct > 30 ? 'bg-ink' : pct > 15 ? 'bg-ink-muted' : 'bg-alarm';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-20 overflow-hidden bg-rule">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="readout text-[11px] text-ink-muted">
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
      href={deviceHref(device)}
      className="group block panel-divide px-4 py-4 transition-colors hover:bg-canvas"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <SourceBadge source={device.source} />
            <RelayTag relay={device.relay} />
            {device.chip && <span className="plate">{device.chip}</span>}
          </div>
          <p className="readout truncate text-sm text-ink group-hover:">{device.id}</p>
        </div>
        <div className="text-right">
          <div className="plate mb-1">earned</div>
          <div className="readout  text-xl leading-none text-ink">
            {earned.toFixed(4)}
            <span className="ml-1 text-[0.5em] text-ink-muted">USDC</span>
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
          <dd className="readout text-sm text-ink/80">{device.bootCount ?? '—'}</dd>
        </div>
        <div>
          <dt className="plate mb-1">top reset</dt>
          <dd className="readout text-sm text-ink/80">
            {topReset ? `#${topReset[0]} ×${topReset[1]}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="plate mb-1">last seen</dt>
          <dd className="readout text-sm text-ink/80">
            {lastSeen ? lastSeen.toLocaleTimeString() : '—'}
          </dd>
        </div>
      </dl>
    </a>
  );
}

const Legend = () => (
  <span className="flex items-center gap-3">
    <SourceBadge source="badge" />
    <span className="normal-case tracking-normal">= real hardware</span>
    <SourceBadge source="simulator" />
    <span className="normal-case tracking-normal">= software mock</span>
  </span>
);

export default async function DevicesPage() {
  const result = await fetchDevices();
  const count = result.ok ? result.data.length : 0;
  const darkCount = result.ok ? result.failed.length : RELAYS.length;

  // One panel per relay: each vendor's fleet stands on its own, and a relay
  // that is down is reported in its own panel instead of blanking the page.
  const groups = result.ok
    ? RELAYS.map((relay) => ({
        relay,
        devices: result.data.filter((d) => d.relay.key === relay.key),
        failure: result.failed.find((f) => f.relay.key === relay.key),
      }))
    : [];

  return (
    <PageShell
      title="Device fleet"
      subtitle={
        MULTI_RELAY
          ? `Every vending node across ${RELAYS.length} relays. The provenance stamp is authoritative: badge means a real ESP32-C3 is attached.`
          : 'Every vending node. The provenance stamp is authoritative: badge means a real ESP32-C3 is attached.'
      }
      stamp={result.ok ? `${count} online${darkCount ? ` · ${darkCount} relay dark` : ''}` : 'no link'}
    >
      {!result.ok ? (
        <RelayOffline path="/api/devices" reason={result.reason} />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ relay, devices, failure }, i) => (
            <Panel
              key={relay.key}
              label={MULTI_RELAY ? `Fleet · ${relay.label}` : 'Fleet'}
              live={!failure}
              stamp={i === 0 ? <Legend /> : MULTI_RELAY ? <span className="normal-case tracking-normal">{new URL(relay.url).hostname}</span> : undefined}
            >
              {failure ? (
                <RelayDark relay={relay} message={failure.message} />
              ) : devices.length === 0 ? (
                <p className="readout px-4 py-12 text-center text-sm text-ink-muted">
                  No devices registered. Start relay-proxy to register one.
                </p>
              ) : (
                devices.map((d) => <DeviceRow key={`${relay.key}:${d.id}`} device={d} />)
              )}
            </Panel>
          ))}
        </div>
      )}
    </PageShell>
  );
}
