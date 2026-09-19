// Animates the 9-step x402 payment sequence as real settlements land from relay-proxy.
// TODO(backend): wire to relay-proxy SSE or WebSocket event stream.
export default function PaymentHandshake() {
  const steps = [
    'AI requests sensor data',
    'ESP32 → HTTP 402',
    'AI checks APEX policy',
    'Policy approved',
    'AI executes USDC transfer',
    'Solana confirms tx',
    'AI submits x402 signature',
    'ESP32 verifies (stateless)',
    'ESP32 returns sensor data',
  ];

  return (
    <section
      id="protocol"
      className="bg-[#070b0a] py-24 px-6 md:px-12 lg:px-16 max-w-6xl mx-auto"
    >
      <h2 className="font-[family-name:var(--font-inter)] font-extrabold text-3xl text-white mb-2">
        The Payment Handshake
      </h2>
      <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-12">
        Nine steps. ~40ms on-device verification.
      </p>

      <ol className="flex flex-col gap-4">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-4">
            <span className="font-[family-name:var(--font-inter)] text-[#5ed29c] text-xs font-bold w-6 shrink-0 mt-0.5">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="font-[family-name:var(--font-inter)] text-sm text-white/70">
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
