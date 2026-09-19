import PageShell from '@/components/PageShell';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchLedger } from '@/lib/relay';
import { ExternalLink } from 'lucide-react';

function solscanUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

function CompressionComparison() {
  const ratio = 48 / 0.05;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-4">
        {/* Standard cost */}
        <div className="flex-1 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-5 py-5">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-2">
            Standard Solana accounts — 10,000 records
          </p>
          <p className="font-[family-name:var(--font-instrument)] text-4xl text-red-400">$48.00</p>
          <p className="font-[family-name:var(--font-inter)] text-xs text-white/30 mt-1">state rent</p>
        </div>
        {/* ZK compressed cost */}
        <div className="flex-1 rounded-xl border border-[#5ed29c]/20 bg-[#5ed29c]/[0.04] px-5 py-5">
          <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-2">
            ZK-compressed via Light Protocol — same 10,000 records
          </p>
          <p className="font-[family-name:var(--font-instrument)] text-4xl text-[#5ed29c]">$0.05</p>
          <p className="font-[family-name:var(--font-inter)] text-xs text-white/30 mt-1">state rent</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-[family-name:var(--font-instrument)] text-3xl text-white">{ratio.toFixed(0)}×</span>
        <span className="font-[family-name:var(--font-inter)] text-sm text-white/40">cheaper. That is the reason this project exists.</span>
      </div>
    </div>
  );
}

export default async function LedgerPage() {
  const result = await fetchLedger();

  return (
    <PageShell
      title="On-chain Ledger"
      subtitle="Settled payments linked to Solscan devnet. ZK-compressed batches make this economically viable."
    >
      <div className="flex flex-col gap-10">
        {/* Compression argument */}
        <div className="flex flex-col gap-4">
          <h2 className="font-[family-name:var(--font-inter)] text-sm font-semibold text-white/40">
            The rent argument
          </h2>
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 max-w-2xl">
            Telemetry at IoT scale means thousands of records per device per day. Standard Solana
            accounts make this cost-prohibitive. Light Protocol ZK compression changes the economics.
          </p>
          <CompressionComparison />
        </div>

        {/* Settlement list */}
        <div className="flex flex-col gap-4">
          <h2 className="font-[family-name:var(--font-inter)] text-sm font-semibold text-white/40">
            Settled transactions
          </h2>

          {!result.ok ? (
            <RelayOffline endpoint="http://localhost:3402/api/ledger" reason={result.reason} />
          ) : result.data.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
              <p className="font-[family-name:var(--font-inter)] text-sm text-white/30">
                No settlements yet — run{' '}
                <code className="text-[#5ed29c] text-xs">npm run demo</code> to generate
                on-chain activity.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-[#5ed29c]/15 bg-[#5ed29c]/[0.03] px-5 py-4">
                <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30 mb-1">Total settled</p>
                <p className="font-[family-name:var(--font-instrument)] text-3xl text-[#5ed29c]">
                  ${(result.data.reduce((s, e) => s + Number(e.amount), 0) / 1_000_000).toFixed(4)}
                </p>
              </div>

              <ul className="flex flex-col gap-2">
                {result.data.map((entry) => (
                  <li
                    key={entry.nonce}
                    className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-3"
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-white/60 truncate">
                        {entry.signature}
                      </p>
                      <p className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/30">
                        nonce: {entry.nonce.slice(0, 16)}…
                      </p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="font-[family-name:var(--font-inter)] text-[10px] text-white/30">
                          {entry.network}
                        </p>
                        <p className="font-[family-name:var(--font-inter)] font-bold text-sm text-[#5ed29c]">
                          ${(Number(entry.amount) / 1_000_000).toFixed(6)}
                        </p>
                      </div>

                      <p className="font-[family-name:var(--font-inter)] font-mono text-[10px] text-white/30">
                        {new Date(entry.issuedAt * 1000).toLocaleTimeString()}
                      </p>

                      <a
                        href={solscanUrl(entry.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[#5ed29c] hover:text-[#4ec08a] transition-colors text-xs font-[family-name:var(--font-inter)]"
                        aria-label={`View transaction ${entry.signature.slice(0, 8)}… on Solscan`}
                      >
                        Solscan
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
