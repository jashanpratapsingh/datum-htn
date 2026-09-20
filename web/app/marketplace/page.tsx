import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { RelayTag, RelayDark } from '@/components/RelayTag';
import { fetchDevices, fetchSales } from '@/lib/relay';
import type { SaleEntry } from '@/lib/relay';
import { dbDirectory, dbSales, type DirectoryDevice } from '@/lib/db';

export const dynamic = 'force-dynamic';

const usd = (micro: string | number) => (Number(micro) / 1_000_000).toFixed(6);
const ago = (sec: number) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  return d < 60 ? `${d}s ago` : d < 3600 ? `${Math.floor(d / 60)}m ago` : `${Math.floor(d / 3600)}h ago`;
};

function SaleRow({ sale, showRelay }: { sale: SaleEntry; showRelay: boolean }) {
  return (
    <li className="panel-divide flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SourceBadge source={sale.source} />
        <RelayTag relay={sale.relay} always={showRelay} />
        <div className="min-w-0">
          <p className="readout truncate text-xs text-ink">{sale.deviceId}</p>
          <p className="readout truncate text-[11px] text-ink-muted" title={sale.signature}>
            {sale.description} · {sale.signature.slice(0, 14)}…{sale.attributed ? ' · account' : ''}
          </p>
        </div>
      </div>
      <div className="readout text-right text-sm text-ink">{usd(sale.amount)}</div>
      <div className="readout w-20 text-right text-xs text-ink-muted">{new Date(sale.timestamp * 1000).toLocaleTimeString()}</div>
    </li>
  );
}

function DeviceRow({ d }: { d: DirectoryDevice }) {
  const dot = d.state === 'live' ? 'bg-ink' : d.state === 'stale' ? 'bg-ink-muted' : 'bg-alarm';
  return (
    <li className="panel-divide flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" title={d.state} />
        <SourceBadge source={d.source} />
        <RelayTag relay={d.relay} always />
        <div className="min-w-0">
          <p className="readout truncate text-xs text-ink">{d.id}</p>
          <p className="readout truncate text-[11px] text-ink-muted" title={d.relay.url}>
            {d.resource} · {d.relay.url || 'no public url'}
          </p>
        </div>
      </div>
      <div className="readout text-right text-sm text-ink">{usd(d.priceMicroUsdc)}</div>
      <div className="readout w-20 text-right text-xs text-ink-muted">{ago(d.lastSeen)}</div>
    </li>
  );
}

export default async function MarketplacePage() {
  // History and the vendor directory come from Supabase, so this page stays
  // complete while a relay is down; the relay is only asked what is live now.
  const [hist, dir, live] = await Promise.all([dbSales(), dbDirectory(), fetchDevices()]);
  const salesResult = hist.ok ? { ok: true as const, data: hist.data, failed: live.failed } : await fetchSales();
  const sales = salesResult.ok ? salesResult.data : [];
  const total = sales.reduce((s, r) => s + Number(r.amount), 0);
  const n = sales.length;
  const devices = dir.ok ? dir.data.devices : [];
  const relaysSeen = new Set(sales.map((s) => s.relay.key)).size;
  const showRelay = relaysSeen > 1 || devices.length > 1;

  return (
    <PageShell
      title="Data marketplace"
      subtitle="Every reading sold, from every device and every relay in the directory. Simulator sales are stamped and never mixed in with hardware."
      stamp={
        salesResult.ok
          ? `${n} sale${n === 1 ? '' : 's'}${hist.ok ? ' · supabase' : ''}${live.failed.length ? ` · ${live.failed.length} relay dark` : ''}`
          : 'no link'
      }
    >
      <div className="flex flex-col gap-5">
        {(devices.length > 0 || live.failed.length > 0) && (
          <Panel label="For sale" stamp={dir.ok ? `${devices.filter((d) => d.state === 'live').length} live · ${devices.length} listed` : undefined}>
            {live.failed.map((f) => (
              <RelayDark key={f.relay.key} relay={f.relay} message={f.message} />
            ))}
            {devices.length > 0 && <ul>{devices.map((d) => <DeviceRow key={`${d.relayId}:${d.id}`} d={d} />)}</ul>}
          </Panel>
        )}

        {!salesResult.ok ? (
          <RelayOffline path="/api/sales" reason={salesResult.reason} />
        ) : n === 0 ? (
          <Panel label="Sales">
            <div className="px-4 py-12 text-center">
              <p className="readout mb-4 text-sm text-ink-muted">Nothing sold yet.</p>
              <Pill href="/agent">Buy the first reading</Pill>
            </div>
          </Panel>
        ) : (
          <>
            <Panel label="Totals" live>
              <div className="grid grid-cols-3">
                <Readout label="sales" value={n} />
                <div className="panel-divide-x">
                  <Readout label="revenue" value={(total / 1e6).toFixed(4)} unit="USDC" tone="amber" />
                </div>
                <div className="panel-divide-x">
                  <Readout label="avg price" value={usd(total / n)} unit="USDC" tone="amber" />
                </div>
              </div>
            </Panel>
            <Panel label="Sales" stamp="newest first">
              <ul>{sales.map((s) => <SaleRow key={`${s.relay.key}:${s.id}`} sale={s} showRelay={showRelay} />)}</ul>
            </Panel>
          </>
        )}
      </div>
    </PageShell>
  );
}
