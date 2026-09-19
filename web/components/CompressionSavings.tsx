// Rent cost comparison: standard Solana accounts vs ZK-compressed (Light Protocol).
export default function CompressionSavings() {
  const rows = [
    { label: 'Standard account (per 10k records)', cost: '$48.00' },
    { label: 'ZK-compressed (per 10k records)', cost: '$0.05' },
  ];

  return (
    <section className="bg-[#070b0a] py-16 px-6 md:px-12 lg:px-16 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <h2 className="font-[family-name:var(--font-inter)] font-extrabold text-xl text-white mb-2">
          Compression Savings
        </h2>
        <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-8">
          Light Protocol ZK compression vs standard Solana state rent.
        </p>

        <div className="flex flex-col gap-3">
          {rows.map(({ label, cost }) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4"
            >
              <span className="font-[family-name:var(--font-inter)] text-sm text-white/70">
                {label}
              </span>
              <span className="font-[family-name:var(--font-inter)] text-sm font-bold text-[#5ed29c]">
                {cost}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
