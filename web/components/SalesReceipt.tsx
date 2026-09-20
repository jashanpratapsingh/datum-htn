/**
 * Settled payments printed like a till receipt: the paper surface. Shared by
 * /ledger and the account page so both print the same way.
 */
export interface ReceiptLine {
  key: string;
  signature: string;
  /** micro-USDC, decimal string */
  amount: string;
  network: string;
  nonce: string;
  timestamp: number;
  /** Extra words after the network, e.g. "via jashan" or "via agent scraper-1". */
  note?: string;
}

const solscan = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

export function SalesReceipt({ lines, title = 'settlement receipt', footer = 'thank you for your data' }: { lines: ReceiptLine[]; title?: string; footer?: string }) {
  const total = lines.reduce((s, e) => s + Number(e.amount), 0) / 1e6;
  return (
    <div className="paper mx-auto w-full max-w-2xl px-6 pb-8 pt-6 sm:px-8">
      <div className="readout mb-1 text-center text-[12px] text-ink-muted">VENDX · solana devnet · {title}</div>
      <div className="readout mb-5 border-b border-dashed border-ink-muted/50 pb-4 text-center text-[11px] text-ink-muted">
        {new Date().toISOString().slice(0, 19).replace('T', '  ')}
      </div>

      <ol className="readout text-[13px]">
        {lines.map((e) => (
          <li key={e.key} className="border-b border-dotted border-ink-muted/40 py-2.5">
            <div className="flex justify-between gap-4">
              <span className="truncate text-ink">{e.signature}</span>
              <span className="shrink-0 tabular-nums text-ink">{(Number(e.amount) / 1e6).toFixed(6)}</span>
            </div>
            <div className="mt-0.5 flex justify-between gap-4 text-[11px] text-ink-muted">
              <span>
                {e.network} · nonce {e.nonce.slice(0, 12)}…{e.note ? ` · ${e.note}` : ''}
              </span>
              <span className="flex items-center gap-3">
                {new Date(e.timestamp * 1000).toLocaleTimeString()}
                <a
                  href={solscan(e.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View transaction ${e.signature.slice(0, 8)}… on Solscan`}
                  className="text-ink underline underline-offset-2 hover:text-ink-muted"
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
      <div className="readout mt-6 text-center text-[11px] text-ink-muted">{footer}</div>
    </div>
  );
}
