'use client';

import { useEffect, useRef } from 'react';

const HLS_URL =
  'https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8';

export default function HlsVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Honour prefers-reduced-motion — CSS hides the element; JS skips loading
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cleanup: (() => void) | undefined;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = HLS_URL;
      video.play().catch(() => {/* autoplay blocked — muted should allow it */});
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (!Hls.isSupported()) return;
        const hls = new Hls({ enableWorker: false });
        hls.loadSource(HLS_URL);
        hls.attachMedia(video);
        hls.once(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        cleanup = () => hls.destroy();
      });
    }

    return () => cleanup?.();
  }, []);

  return (
    <video
      ref={videoRef}
      className="hero-video absolute inset-0 w-full h-full object-cover opacity-60"
      muted
      autoPlay
      loop
      playsInline
      aria-hidden="true"
    />
  );
}
