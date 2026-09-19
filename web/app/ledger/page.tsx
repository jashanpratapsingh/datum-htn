import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { RelayOffline } from '@/components/RelayOffline';
import { fetchLedger } from '@/lib/relay';

const solscan = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

function RentArgument() {
  return (
    <Panel label="The rent argument" stamp="10 000 records">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <Readout label="standard Solana accounts" value="48.00" unit="USDC rent" tone="alarm" size="lg" />
        <div className="panel-divide md:panel-divide-x md:border-t-0">
          <Readout label="ZK-compressed via Light Protocol" value="0.05" unit="USDC rent" tone="amber" size="lg" />
        </div>
      </div>
      <p className="panel-divide px-4 py-3.5 text-[15px] text-phosphor/85">
        <span className="readout text-phosphor">960×</span> cheaper. Thousands of readings a day per device
        is only viable if storing them costs nearly nothing — that is the reason this project exists.
      </p>
    </Panel>
  );
}

export default async function LedgerPage() {
  const result = await fetchLedger();
  const entries = result.ok ? result.data : [];
  const total = entries.reduce((s, e) => s + Number(e.amount), 0) / 1e6;

  return (
    <PageShell
      title="On-chain ledger"
      subtitle="Every settled payment, linked to Solscan devnet. Printed the way a receipt is."
      stamp={result.ok ? `${entries.length} settled` : 'no link'}
    >
      <div className="flex flex-col gap-5">
        <RentArgument />

        {!result.ok ? (
          <RelayOffline path="/api/ledger" reason={result.reason} />
        ) : entries.length === 0 ? (
          <Panel label="Settled">
            <p className="readout px-4 py-12 text-center text-sm text-phosphor-dim">
              Nothing settled yet. Run <span className="text-phosphor">npm run demo</span> to settle a payment.
            </p>
          </Panel>
        ) : (
          /* The second material. A receipt is paper — light, printed, torn off the roll. */
          <div className="paper paper-tear mx-auto w-full max-w-2xl px-6 pb-8 pt-6 sm:px-8">
            <div className="readout mb-1 text-center text-[11px] uppercase tracking-[0.22em] text-ink-fade">
              VENDX · solana devnet · settlement receipt
            </div>
            <div className="readout mb-5 border-b border-dashed border-ink-fade/50 pb-4 text-center text-[11px] text-ink-fade">
              {new Date().toISOString().slice(0, 19).replace('T', '  ')}
            </div>

            <ol className="readout text-[13px]">
              {entries.map((e) => (
                <li key={e.nonce} className="border-b border-dotted border-ink-fade/40 py-2.5">
                  <div className="flex justify-between gap-4">
                    <span className="truncate text-ink">{e.signature}</span>
                    <span className="shrink-0 tabular-nums text-ink">{(Number(e.amount) / 1e6).toFixed(6)}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between gap-4 text-[11px] text-ink-fade">
                    <span>{e.network} · nonce {e.nonce.slice(0, 12)}…</span>
                    <span className="flex items-center gap-3">
                      {new Date(e.issuedAt * 1000).toLocaleTimeString()}
                      <a
                        href={solscan(e.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View transaction ${e.signature.slice(0, 8)}… on Solscan`}
                        className="text-ink underline underline-offset-2 hover:text-ink-fade"
                      >
                        solscan
                      </a>
                    </span>
                  </div>
                </li>
              ))}
            </ol>

            <div className="readout mt-4 flex justify-between border-t-2 border-ink pt-3 text-[15px] font-semibold text-ink">
              <span>TOTAL</span>
              <span className="tabular-nums">{total.toFixed(6)} USDC</span>
            </div>
            <div className="readout mt-6 text-center text-[11px] text-ink-fade">
              thank you for your data
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
