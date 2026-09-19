// Settled purchases streaming in as they land from relay-proxy.
// TODO(backend): connect to relay-proxy SSE /events stream.
export default function TelemetryTicker() {
  return (
    <section className="bg-[#070b0a] py-16 px-6 md:px-12 lg:px-16 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <h2 className="font-[family-name:var(--font-inter)] font-extrabold text-xl text-white mb-6">
          Live Settlements
        </h2>

        <div className="font-[family-name:var(--font-inter)] text-sm text-white/30 border border-white/10 rounded-xl p-6 bg-white/[0.02] h-32 flex items-center justify-center">
          Waiting for relay events…
        </div>
      </div>
    </section>
  );
}
