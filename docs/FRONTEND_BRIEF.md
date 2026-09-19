# Frontend brief

Stack: **Next.js 16.3.5** (App Router) · **Tailwind 4.3.3** · TypeScript ·
`hls.js` 1.7.3 · `lucide-react` 1.47.0.

> Tailwind 4 is CSS-first — there is no `tailwind.config.js`. The accent colour,
> the three font families and custom shadows go in an `@theme` block in
> `globals.css`. The liquid-glass card's masked `::before` border,
> `background-blend-mode: luminosity` and `-webkit-mask-composite: xor` are not
> expressible as utilities and stay hand-written CSS.

## 1. The hero spec — implement exactly

### Background & layout
- Full-screen background video, HLS:
  `https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8`
  via `hls.js` with **`enableWorker: false`** (stability in sandboxed environments).
- Video at **60% opacity**. Dark linear gradient from the left (`#070b0a` →
  transparent) plus a bottom-up gradient for readability.
- Three thin vertical grid lines (`white/10`) at **25%, 50%, 75%**, desktop only.
- Large horizontal SVG ellipse glow, center-top, cyan/dark-green hue, **25px
  Gaussian blur**.

### The liquid glass card
- **200×200px**, floating above the headline, shifted up exactly `translate-y-[-50px]`.
- `background: rgba(255,255,255,0.01)` with `background-blend-mode: luminosity`
- `backdrop-filter: blur(4px)`
- `box-shadow: inset 0 1px 1px rgba(255,255,255,0.1)`
- Border: `::before` with `inset: 0`, `padding: 1.4px`, a 180° white linear
  gradient, and `-webkit-mask-composite: xor` / `mask-composite: exclude`.
- Content: `[ 2025 ]` tag (14px), an 18px headline with one word in **Instrument
  Serif italic**, and an 11px description.

### Typography
- Eyebrow: Plus Jakarta Sans, bold, 11px, `#5ed29c`.
- Headline: Inter Extra Bold, uppercase, `tracking-tight`, 40px mobile → 72px
  desktop. **The final period is `#5ed29c`.**
- Description: Inter, 14px, 70% white, `max-width: 512px`.
- Primary CTA: rounded-full, bg `#5ed29c`, text `#070b0a`, uppercase, bold, with
  an `ArrowRight` icon.

### Navigation
- Sticky/absolute header, white minimalist logo.
- Desktop links Inter 16px, hover `#5ed29c`.
- Mobile: functional hamburger toggling a full-screen dark overlay.

## 2. The VENDX re-skin

The spec above is a coding-education hero for "CodeNest". VENDX is a machine-to-
machine data marketplace, so the *structure, motion and craft* are kept verbatim
and only the language changes:

| Spec slot | CodeNest | VENDX |
| --- | --- | --- |
| Eyebrow | `Career-Ready Curriculum` | `AUTONOMOUS DEVICE ECONOMY` |
| Headline | `LAUNCH YOUR CODING CAREER.` | `YOUR SENSORS. THEIR WALLETS.` |
| Description | "Master in-demand coding skills…" | "A $5 ESP32 that charges AI agents for its own telemetry. HTTP 402, USDC on Solana, settled in milliseconds." |
| CTA | `Get Started` | `Watch a device get paid` |
| Card tag | `[ 2025 ]` | `[ x402 ]` |
| Card headline | "Taught by *Industry* Professionals" | "Paid by *Autonomous* Agents" (italic word keeps Instrument Serif) |
| Nav | PROJECTS · BLOG · ABOUT · RESUME | PROTOCOL · DEVICES · DOCS · LEDGER |

Accent `#5ed29c` and base `#070b0a` are unchanged — a green-on-near-black reads
as circuitry and settles naturally on a hardware product.

## 3. Components beyond the hero

The hero alone is not a product. These sit below it and are driven by real relay
events, not mock timers:

| Component | What it shows |
| --- | --- |
| `<PaymentHandshake/>` | The 9-step x402 sequence animating as a real payment settles |
| `<VendorMap/>` | Devices as nodes — live price, uptime, lifetime earnings |
| `<TelemetryTicker/>` | Settled purchases streaming in as they land |
| `<PolicyGauge/>` | The $5.00/day APEX budget burning down |
| `<CompressionSavings/>` | Rent cost: standard Solana accounts vs ZK-compressed |
| `<Explorer/>` | Every settled signature, linked to Solscan devnet |

Charts and gauges: load the `dataviz` skill before writing chart code.
Design conflicts: `frontend-design` wins over `ui-ux-pro-max` (see root `CLAUDE.md`).

## 4. Accessibility floor

Non-negotiable, because a dark hero over video is exactly where this gets
dropped: visible focus rings on every interactive element, the mobile menu
traps focus and closes on Escape, the video is `muted`/`playsinline` and is
skipped under `prefers-reduced-motion`, and all text clears 4.5:1 against its
backdrop — check the description at 70% white specifically.
