// APEX $5.00/day budget burning down.
// TODO(backend): read spend total from agent-buyer policy endpoint.
export default function PolicyGauge() {
  const daily = 5.0;
  const spent = 0;
  const pct = Math.min((spent / daily) * 100, 100);

  return (
    <section className="bg-[#070b0a] py-16 px-6 md:px-12 lg:px-16 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <h2 className="font-[family-name:var(--font-inter)] font-extrabold text-xl text-white mb-2">
          APEX Spend Policy
        </h2>
        <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-6">
          ${spent.toFixed(2)} / ${daily.toFixed(2)} today
        </p>

        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#5ed29c] transition-all duration-500"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={spent}
            aria-valuemin={0}
            aria-valuemax={daily}
            aria-label={`$${spent.toFixed(2)} of $${daily.toFixed(2)} daily budget used`}
          />
        </div>
      </div>
    </section>
  );
}
