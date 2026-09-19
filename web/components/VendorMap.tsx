// Device nodes — live price, uptime, lifetime earnings.
// TODO(backend): subscribe to relay-proxy device roster endpoint.
export default function VendorMap() {
  return (
    <section
      id="devices"
      className="bg-[#070b0a] py-24 px-6 md:px-12 lg:px-16 border-t border-white/5"
    >
      <div className="max-w-6xl mx-auto">
        <h2 className="font-[family-name:var(--font-inter)] font-extrabold text-3xl text-white mb-2">
          Device Network
        </h2>
        <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-12">
          Every online vendor — live price, uptime, lifetime earnings.
        </p>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] h-64 flex items-center justify-center">
          <p className="font-[family-name:var(--font-inter)] text-sm text-white/30">
            Awaiting device roster from relay-proxy…
          </p>
        </div>
      </div>
    </section>
  );
}
