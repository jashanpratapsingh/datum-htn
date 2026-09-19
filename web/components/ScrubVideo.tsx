'use client';

import { useEffect, useRef } from 'react';

const VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260530_042513_df96a13b-6155-4f6e-8b93-c9dee66fba08.mp4';

/** How much of the clip one full sweep of the window scrubs through. */
const SENSITIVITY = 0.8;

/**
 * Background video scrubbed by horizontal mouse movement.
 *
 * The video never plays on its own — moving the cursor is what advances it,
 * which makes the page feel like a machine you are operating rather than one
 * playing at you.
 *
 * Seeking is queued rather than fired per event: a `mousemove` stream is far
 * faster than a decoder can seek, and assigning `currentTime` on every event
 * floods it into a stutter. We hold a target, seek once, and only issue the
 * next seek from `onSeeked` if the target has moved since.
 */
export default function ScrubVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const targetRef = useRef(0);
  const seekingRef = useRef(false);
  const prevXRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Pointer-driven scrubbing is meaningless without a pointer, and actively
    // unwanted under reduced-motion. Both fall back to a held frame.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (reduced || coarse) {
      const hold = () => {
        video.currentTime = Math.min(0.1, video.duration || 0.1);
      };
      video.addEventListener('loadedmetadata', hold, { once: true });
      return () => video.removeEventListener('loadedmetadata', hold);
    }

    const pump = () => {
      if (seekingRef.current) return;
      const delta = Math.abs(video.currentTime - targetRef.current);
      if (delta < 0.01) return;
      seekingRef.current = true;
      video.currentTime = targetRef.current;
    };

    const onSeeked = () => {
      seekingRef.current = false;
      pump(); // the target may have moved while we were seeking
    };

    const onMouseMove = (e: MouseEvent) => {
      const duration = video.duration;
      if (!duration || Number.isNaN(duration)) return;

      if (prevXRef.current === null) {
        prevXRef.current = e.clientX;
        return;
      }
      const delta = e.clientX - prevXRef.current;
      prevXRef.current = e.clientX;

      const offset = (delta / window.innerWidth) * SENSITIVITY * duration;
      targetRef.current = Math.max(0, Math.min(duration, targetRef.current + offset));
      pump();
    };

    video.addEventListener('seeked', onSeeked);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      video.removeEventListener('seeked', onSeeked);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src={VIDEO_URL}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      className="absolute inset-0 z-0 h-full w-full object-cover"
      style={{
        objectPosition: '78% center',
        // The subject sits on the right, the sentence on the left. Fade the
        // clip into the canvas so the two never fight for the same pixels.
        maskImage:
          'linear-gradient(to right, transparent 22%, #000 58%), linear-gradient(to top, transparent 0%, #000 42%)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent 22%, #000 58%), linear-gradient(to top, transparent 0%, #000 42%)',
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
      }}
    />
  );
}
