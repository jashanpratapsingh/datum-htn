import PageShell from '@/components/PageShell';
import { SourceBadge } from '@/components/SourceBadge';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchSales } from '@/lib/relay';
import type { SaleEntry } from '@/lib/relay';
import { ShoppingCart } from 'lucide-react';

function microUsdcToUsd(micro: string): string {
  return (Number(micro) / 1_000_000).toFixed(6);
}

function SaleRow({ sale }: { sale: SaleEntry }) {
  const ts = new Date(sale.timestamp * 1000);
  return (
    <li className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <SourceBadge source={sale.source} />
        <div className="flex flex-col min-w-0">
          <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/70 truncate">
            {sale.deviceId}
          </p>
          <p className="font-[family-name:var(--font-inter)] text-xs text-white/40">
            {sale.description || sale.resource}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-6 shrink-0">
        <div className="text-right">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider">
            Price
          </p>
          <p className="font-[family-name:var(--font-inter)] font-bold text-sm text-[#5ed29c]">
            ${microUsdcToUsd(sale.amount)}
          </p>
        </div>

        <div className="text-right">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider">
            Sold at
          </p>
          <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/50">
            {ts.toLocaleTimeString()}
          </p>
        </div>
      </div>
    </li>
  );
}

export default async function MarketplacePage() {
  const result = await fetchSales();

  const totalRevenueMicro = result.ok
    ? result.data.reduce((s, r) => s + Number(r.amount), 0)
    : 0;

  return (
    <PageShell
      title="Data Marketplace"
      subtitle="Every data sale from every device. Provenance label on each row — simulator sales are not mixed with badge hardware."
    >
      {!result.ok ? (
        <RelayOffline endpoint="http://localhost:3402/api/sales" reason={result.reason} />
      ) : result.data.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
          <ShoppingCart size={24} className="text-white/20 mx-auto mb-3" aria-hidden="true" />
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/40">
            No sales recorded yet — run{' '}
            <code className="text-[#5ed29c] text-xs">npm run demo</code> to generate activity.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
              <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
                Total sales
              </p>
              <p className="font-[family-name:var(--font-inter)] font-extrabold text-2xl text-white">
                {result.data.length}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
              <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
                Total revenue
              </p>
              <p className="font-[family-name:var(--font-inter)] font-extrabold text-2xl text-[#5ed29c]">
                ${(totalRevenueMicro / 1_000_000).toFixed(4)}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4">
              <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 uppercase tracking-wider mb-1">
                Avg price
              </p>
              <p className="font-[family-name:var(--font-inter)] font-extrabold text-2xl text-white">
                ${result.data.length
                  ? (totalRevenueMicro / result.data.length / 1_000_000).toFixed(6)
                  : '0.000000'}
              </p>
            </div>
          </div>

          {/* Sale list */}
          <ul className="flex flex-col gap-2">
            {result.data.map((s) => (
              <SaleRow key={s.id} sale={s} />
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
}
