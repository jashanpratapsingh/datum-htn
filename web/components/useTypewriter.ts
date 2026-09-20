'use client';

import { useEffect, useState } from 'react';

export type LinePhase = 'pending' | 'typing' | 'settled';

export interface SequenceLine {
  /** Characters revealed so far. */
  text: string;
  /** Not started, being typed, or typed and handed off to the next line. */
  phase: LinePhase;
}

export interface TypewriterSequenceOptions {
  /** Milliseconds per character. */
  speed?: number;
  /** Pause before the first character. */
  startDelay?: number;
  /** How long a finished line sits sharp before it settles. */
  holdMs?: number;
  /** Gap between a line settling and the next line's first character. */
  gapMs?: number;
}

/**
 * Types `lines` one after another. A line is typed in full, held for a beat,
 * then marked `settled` — the caller renders that as the blur-out — and only
 * then does the next line start. The last line stays sharp.
 *
 * `done` flips when the final line has finished typing.
 */
export function useTypewriterSequence(
  lines: readonly string[],
  { speed = 34, startDelay = 600, holdMs = 650, gapMs = 350 }: TypewriterSequenceOptions = {},
) {
  const [state, setState] = useState<SequenceLine[]>(() =>
    lines.map(() => ({ text: '', phase: 'pending' })),
  );
  const [done, setDone] = useState(false);

  // Lines come from a constant, but keying the effect on the joined text keeps
  // it honest if a caller ever passes a fresh array each render.
  const key = lines.join('\u0000');

  useEffect(() => {
    // Typing out a sentence is motion; under reduced-motion, just say it.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setState(
        lines.map((text, i) => ({
          text,
          phase: i === lines.length - 1 ? 'typing' : 'settled',
        })),
      );
      setDone(true);
      return;
    }

    setState(lines.map(() => ({ text: '', phase: 'pending' })));
    setDone(false);

    const timers: ReturnType<typeof setTimeout>[] = [];
    let interval: ReturnType<typeof setInterval> | undefined;
    const after = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms));
    };

    const typeLine = (li: number) => {
      const text = lines[li];
      let i = 0;
      setState((prev) => prev.map((l, j) => (j === li ? { text: '', phase: 'typing' } : l)));
      interval = setInterval(() => {
        i += 1;
        const slice = text.slice(0, i);
        setState((prev) => prev.map((l, j) => (j === li ? { ...l, text: slice } : l)));
        if (i < text.length) return;
        clearInterval(interval);
        if (li === lines.length - 1) {
          setDone(true);
          return;
        }
        // Hold sharp, settle (blur out), breathe, then start the next line.
        after(holdMs, () => {
          setState((prev) => prev.map((l, j) => (j === li ? { ...l, phase: 'settled' } : l)));
          after(gapMs, () => typeLine(li + 1));
        });
      }, speed);
    };

    if (lines.length === 0) {
      setDone(true);
    } else {
      after(startDelay, () => typeLine(0));
    }

    return () => {
      timers.forEach(clearTimeout);
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, speed, startDelay, holdMs, gapMs]);

  return { lines: state, done };
}
