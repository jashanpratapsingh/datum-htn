'use client';

import { useEffect, useState } from 'react';

/**
 * Reveals `text` one character at a time.
 *
 * `done` is exposed separately so the caller can drop the cursor when the line
 * finishes without having to compare lengths itself.
 */
export function useTypewriter(text: string, speed = 38, startDelay = 600) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Typing out a sentence is motion; under reduced-motion, just say it.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplayed(text);
      setDone(true);
      return;
    }

    setDisplayed('');
    setDone(false);
    let i = 0;
    let interval: ReturnType<typeof setInterval>;

    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setDisplayed(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval);
          setDone(true);
        }
      }, speed);
    }, startDelay);

    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [text, speed, startDelay]);

  return { displayed, done };
}
