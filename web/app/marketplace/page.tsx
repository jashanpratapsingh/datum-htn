import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchSales } from '@/lib/relay';
import type { SaleEntry } from '@/lib/relay';

const usd = (micro: string | number) => (Number(micro) / 1_000_000).toFixed(6);

function SaleRow({ sale }: { sale: SaleEntry }) {
  return (
    <li className="panel-divide flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SourceBadge source={sale.source} />
        <div className="min-w-0">
          <p className="readout truncate text-xs text-ink">{sale.deviceId}</p>
          <p className="readout truncate text-[11px] text-ink-muted" title={sale.signature}>
            {sale.description} · {sale.signature.slice(0, 14)}…
          </p>
        </div>
      </div>
      <div className="readout text-right text-sm text-ink">{usd(sale.amount)}</div>
      <div className="readout w-20 text-right text-xs text-ink-muted">
        {new Date(sale.timestamp * 1000).toLocaleTimeString()}
      </div>
    </li>
  );
}

export default async function MarketplacePage() {
  const result = await fetchSales();
  const total = result.ok ? result.data.reduce((s, r) => s + Number(r.amount), 0) : 0;
  const n = result.ok ? result.data.length : 0;

  return (
    <PageShell
      title="Data marketplace"
      subtitle="Every reading sold, from every device. Simulator sales are stamped and never mixed in with hardware."
      stamp={result.ok ? `${n} sale${n === 1 ? '' : 's'}` : 'no link'}
    >
      {!result.ok ? (
        <RelayOffline path="/api/sales" reason={result.reason} />
      ) : n === 0 ? (
        <Panel label="Sales">
          <p className="readout px-4 py-12 text-center text-sm text-ink-muted">
            Nothing sold yet. Run <span className="text-ink">npm run demo</span> to make a sale.
          </p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          <Panel label="Totals" live>
            <div className="grid grid-cols-3">
              <Readout label="sales" value={n} />
              <div className="panel-divide-x"><Readout label="revenue" value={(total / 1e6).toFixed(4)} unit="USDC" tone="amber" /></div>
              <div className="panel-divide-x"><Readout label="avg price" value={usd(total / n)} unit="USDC" tone="amber" /></div>
            </div>
          </Panel>
          <Panel label="Sales" stamp="newest first">
            <ul>{result.data.map((s) => <SaleRow key={s.id} sale={s} />)}</ul>
          </Panel>
        </div>
      )}
    </PageShell>
  );
}
