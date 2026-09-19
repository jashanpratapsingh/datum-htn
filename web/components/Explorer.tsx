import type { ReceiptBody } from '@vendx/protocol';

// Every settled signature, linked to Solscan devnet.
// TODO(backend): fetch settled receipts from relay-proxy or Supabase.
const MOCK_RECEIPTS: ReceiptBody[] = [];

function solscanUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

export default function Explorer() {
  return (
    <section
      id="ledger"
      className="bg-[#070b0a] py-24 px-6 md:px-12 lg:px-16 border-t border-white/5"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="font-[family-name:var(--font-inter)] font-extrabold text-3xl text-white mb-2">
          Settlement Explorer
        </h2>
        <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-12">
          Every confirmed transaction, linked to Solscan devnet.
        </p>

        {MOCK_RECEIPTS.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
            <p className="font-[family-name:var(--font-inter)] text-sm text-white/30">
              No settlements yet — run the demo to generate on-chain activity.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {MOCK_RECEIPTS.map((r) => (
              <li
                key={r.nonce}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-5 py-3"
              >
                <span className="font-[family-name:var(--font-inter)] text-xs text-white/50 font-mono truncate max-w-[60%]">
                  {r.signature}
                </span>
                <a
                  href={solscanUrl(r.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-[family-name:var(--font-inter)] text-xs text-[#5ed29c] hover:underline shrink-0 ml-4"
                >
                  View on Solscan ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
