export default function LiquidGlassCard() {
  return (
    <div
      className="liquid-glass-card -translate-y-[50px] flex flex-col justify-between p-5"
      aria-hidden="true"
    >
      {/* Tag */}
      <span
        className="font-[family-name:var(--font-inter)] text-[14px] text-white/60 font-normal"
      >
        [ x402 ]
      </span>

      {/* Headline */}
      <p className="font-[family-name:var(--font-inter)] text-[18px] font-semibold text-white leading-snug">
        Paid by{' '}
        <em className="font-[family-name:var(--font-instrument)] not-italic italic font-normal">
          Autonomous
        </em>{' '}
        Agents
      </p>

      {/* Description */}
      <p className="font-[family-name:var(--font-inter)] text-[11px] text-white/50 leading-relaxed">
        Every byte metered.<br />Every transfer settled.
      </p>
    </div>
  );
}
