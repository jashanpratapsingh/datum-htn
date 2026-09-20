'use client';

import { useEffect, useState } from 'react';
import ScrubVideo from './ScrubVideo';
import { Pill, CopyPill } from './Pill';
import EconomicsPopup from './EconomicsPopup';
import { useTypewriterSequence } from './useTypewriter';
import { CONTACT_EMAIL } from '@/lib/site';

/*
  The device introduces itself in three beats. Each line is typed, sits for a
  moment, then falls out of focus as the next one is typed underneath — the
  way a readout looks before your eyes adjust to the newest number.
*/
const LINES = [
  'Meet a five-dollar sensor with its own wallet.',
  'It sells its readings to AI agents and gets paid in USDC.',
  'It has been selling all morning. What do you want to know?',
] as const;

export default function HeroSection() {
  const { lines, done } = useTypewriterSequence(LINES);
  const [pillsIn, setPillsIn] = useState(false);

  // Pills arrive on their own clock, not the typewriter's — waiting for the
  // sequence to finish would hide the only navigation on the page for 6s.
  useEffect(() => {
    const t = setTimeout(() => setPillsIn(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="relative h-screen min-h-[640px] overflow-hidden">
      <ScrubVideo />

      <div className="relative z-[3] flex h-full flex-col justify-end px-5 pb-16 sm:px-8 md:justify-center md:px-12 md:pb-0">
        <div className="max-w-[46rem]">
          {/*
            The device's own lines are the page heading. The full copy is
            exposed to assistive tech immediately; the character-by-character
            reveal, the blur-out and the cursor are decoration.
          */}
          <h1
            className="mb-7 font-normal text-ink"
            style={{
              fontSize: 'clamp(20px, 2.6vw, 30px)',
              lineHeight: 1.3,
              letterSpacing: '-0.01em',
            }}
          >
            <span className="sr-only">{LINES.join(' ')}</span>
            <span aria-hidden="true" className="flex flex-col gap-[0.35em]">
              {LINES.map((full, i) => {
                const line = lines[i];
                return (
                  <span
                    key={full}
                    className={`type-line relative block ${
                      line.phase === 'settled' ? 'type-line-settled' : ''
                    }`}
                  >
                    {/* The finished sentence, invisible, holds the line's height
                        so nothing below jumps while it is being typed. */}
                    <span className="invisible select-none">{full}</span>
                    <span className="absolute inset-0">
                      {line.text}
                      {line.phase === 'typing' && !done && (
                        <span className="cursor-blink ml-[2px] inline-block h-[1em] w-[2px] align-middle bg-ink" />
                      )}
                    </span>
                  </span>
                );
              })}
            </span>
          </h1>

          <div className={`flex flex-wrap rise ${pillsIn ? 'rise-in' : ''}`}>
            <Pill href="/agent">Watch a device get paid</Pill>
            <Pill href="/devices">Browse the fleet</Pill>
            <Pill href="/protocol">Read the protocol</Pill>
            <Pill href="/ledger">See what settled</Pill>
            <EconomicsPopup />
            <CopyPill prefix="Reach us:" value={CONTACT_EMAIL} label={CONTACT_EMAIL} />
          </div>
        </div>
      </div>
    </section>
  );
}
