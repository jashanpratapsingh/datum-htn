import { ArrowRight } from 'lucide-react';
import HlsVideo from './HlsVideo';
import LiquidGlassCard from './LiquidGlassCard';

export default function HeroSection() {
  return (
    <section className="relative h-screen min-h-[640px] overflow-hidden bg-[#070b0a]">
      {/* HLS background video */}
      <HlsVideo />

      {/* Left-to-right dark vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to right, #070b0a 0%, transparent 65%)',
        }}
      />

      {/* Bottom-up readability gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(7,11,10,0.85) 0%, transparent 55%)',
        }}
      />

      {/* SVG glow — large horizontal ellipse, center-top, cyan/dark-green */}
      <svg
        className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
        width="900"
        height="320"
        viewBox="0 0 900 320"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="glowGrad" cx="50%" cy="30%" r="50%">
            <stop offset="0%" stopColor="#5ed29c" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#0d4a2e" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#070b0a" stopOpacity="0" />
          </radialGradient>
          <filter id="glowBlur">
            <feGaussianBlur stdDeviation="25" />
          </filter>
        </defs>
        <ellipse
          cx="450"
          cy="60"
          rx="420"
          ry="130"
          fill="url(#glowGrad)"
          filter="url(#glowBlur)"
        />
      </svg>

      {/* Vertical grid lines — desktop only */}
      <div className="hidden lg:block absolute inset-0 pointer-events-none" aria-hidden="true">
        {(['25%', '50%', '75%'] as const).map((pos) => (
          <div
            key={pos}
            className="absolute top-0 bottom-0 w-px bg-white/10"
            style={{ left: pos }}
          />
        ))}
      </div>

      {/* Hero content */}
      <div className="relative z-10 flex flex-col items-start justify-center h-full px-6 md:px-12 lg:px-16 max-w-6xl">

        {/* Liquid-glass card floating above headline */}
        <LiquidGlassCard />

        {/* Eyebrow */}
        <p
          className="font-[family-name:var(--font-jakarta)] font-bold text-[11px] text-[#5ed29c] uppercase tracking-[0.15em] mb-4"
        >
          AUTONOMOUS DEVICE ECONOMY
        </p>

        {/* Headline */}
        <h1
          className="font-[family-name:var(--font-inter)] font-extrabold uppercase tracking-tight text-[40px] leading-[1.05] md:text-[72px] text-white mb-5 max-w-3xl"
        >
          YOUR SENSORS. THEIR WALLETS
          <span className="text-[#5ed29c]">.</span>
        </h1>

        {/* Description */}
        <p
          className="font-[family-name:var(--font-inter)] text-[14px] text-white/70 leading-relaxed mb-8"
          style={{ maxWidth: '512px' }}
        >
          A $5 ESP32 that charges AI agents for its own telemetry. HTTP 402,
          USDC on Solana, settled in milliseconds.
        </p>

        {/* Primary CTA */}
        <a
          href="#demo"
          className="inline-flex items-center gap-2 rounded-full bg-[#5ed29c] text-[#070b0a] uppercase font-bold text-sm px-6 py-3 hover:bg-[#4ec08a] transition-colors duration-200"
        >
          Watch a device get paid
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
