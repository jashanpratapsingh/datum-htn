'use client';

import { useEffect, useState } from 'react';
import ScrubVideo from './ScrubVideo';
import { Pill, CopyPill } from './Pill';
import { useTypewriter } from './useTypewriter';

const LINE =
  'Glad you stopped by. It has been selling readings all morning. What do you want to know?';

export default function HeroSection() {
  const { displayed, done } = useTypewriter(LINE);
  const [pillsIn, setPillsIn] = useState(false);

  // Pills arrive on their own clock, not the typewriter's — waiting for the
  // sentence to finish would hide the only navigation on the page for 4s.
  useEffect(() => {
    const t = setTimeout(() => setPillsIn(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="relative h-screen min-h-[640px] overflow-hidden">
      <ScrubVideo />

      {/* Smoked glass over the video: the readout sits behind a bezel. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1]"
        style={{
          background:
            'linear-gradient(to right, var(--color-glass) 0%, rgba(7,16,20,0.82) 38%, rgba(7,16,20,0.25) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-[1]"
        style={{
          background:
            'linear-gradient(to top, var(--color-glass) 0%, rgba(7,16,20,0.4) 42%, transparent 70%)',
        }}
      />
      <div aria-hidden="true" className="scanlines absolute inset-0 z-[2] opacity-60" />

      <div className="relative z-[3] flex h-full flex-col justify-end px-5 pb-14 sm:px-8 md:justify-center md:px-12 md:pb-0">
        <div className="max-w-2xl">
          {/* Out-of-focus, the way a readout looks before your eyes adjust. */}
          <p
            aria-hidden="true"
            className="mb-5 select-none text-phosphor-dim sm:mb-6"
            style={{
              fontSize: 'clamp(18px, 4vw, 26px)',
              lineHeight: 1.3,
              filter: 'blur(4px)',
            }}
          >
            Hey there — this is a five-dollar sensor.
            <br />
            It bills software for its own readings.
          </p>

          {/*
            The device's own line is the page heading — it is the primary
            statement here, and it keeps a real visible h1 on the route.
            The full sentence is exposed to assistive tech immediately;
            the character-by-character reveal and cursor are decoration.
          */}
          <h1
            className="mb-6 font-normal text-phosphor font-[family-name:var(--font-readout)]"
            style={{
              fontSize: 'clamp(18px, 4vw, 26px)',
              lineHeight: 1.35,
              minHeight: 'calc(2 * 1.35em)',
            }}
          >
            <span className="sr-only">{LINE}</span>
            <span aria-hidden="true">{displayed}</span>
            {!done && (
              <span
                aria-hidden="true"
                className="cursor-blink ml-[2px] inline-block h-[1.1em] w-[2px] align-middle bg-phosphor"
              />
            )}
          </h1>

          <div className={`flex flex-wrap gap-y-1 rise ${pillsIn ? 'rise-in' : ''}`}>
            <Pill href="/agent">Watch a device get paid</Pill>
            <Pill href="/devices">Browse the fleet</Pill>
            <Pill href="/protocol">Read the protocol</Pill>
            <Pill href="/ledger">See what settled</Pill>
            <CopyPill value="hello@vendx.dev" label="hello@vendx.dev" />
          </div>
        </div>
      </div>
    </section>
  );
}
