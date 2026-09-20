'use client';

import { useEffect, useState } from 'react';
import ScrubVideo from './ScrubVideo';
import { Pill, CopyPill } from './Pill';
import EconomicsPopup from './EconomicsPopup';
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

      <div className="relative z-[3] flex h-full flex-col justify-end px-5 pb-16 sm:px-8 md:justify-center md:px-12 md:pb-0">
        <div className="max-w-[46rem]">
          {/* Out of focus, the way a readout looks before your eyes adjust. */}
          <p
            aria-hidden="true"
            className="mb-6 select-none text-ink-muted"
            style={{
              fontSize: 'clamp(18px, 2.6vw, 28px)',
              lineHeight: 1.3,
              filter: 'blur(4px)',
            }}
          >
            Hey there — this is a five-dollar sensor.
            <br />
            It bills software for its own readings.
          </p>

          {/*
            The device's own line is the page heading. The full sentence is
            exposed to assistive tech immediately; the character-by-character
            reveal and cursor are decoration.
          */}
          <h1
            className="mb-7 font-normal text-ink"
            style={{
              fontSize: 'clamp(20px, 2.6vw, 30px)',
              lineHeight: 1.3,
              letterSpacing: '-0.01em',
              minHeight: 'calc(2 * 1.3em)',
            }}
          >
            <span className="sr-only">{LINE}</span>
            <span aria-hidden="true">{displayed}</span>
            {!done && (
              <span
                aria-hidden="true"
                className="cursor-blink ml-[2px] inline-block h-[1em] w-[2px] align-middle bg-ink"
              />
            )}
          </h1>

          <div className={`flex flex-wrap rise ${pillsIn ? 'rise-in' : ''}`}>
            <Pill href="/agent">Watch a device get paid</Pill>
            <Pill href="/devices">Browse the fleet</Pill>
            <Pill href="/protocol">Read the protocol</Pill>
            <Pill href="/ledger">See what settled</Pill>
            <EconomicsPopup />
            <CopyPill prefix="Reach us:" value="hello@vendx.dev" label="hello@vendx.dev" />
          </div>
        </div>
      </div>
    </section>
  );
}
