'use client';

import { useState } from 'react';

const base =
  'inline-flex items-center justify-center rounded-full text-[13px] sm:text-[15px] ' +
  'px-4 sm:px-5 py-[0.45em] mr-[0.4em] mb-[0.5em] whitespace-nowrap ' +
  'transition-colors duration-200';

/** A white pill. Links to somewhere that actually exists. */
export function Pill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={`${base} bg-pill text-ink hover:bg-ink hover:text-pill`}>
      {children}
    </a>
  );
}

/**
 * Outlined pill that copies a value.
 *
 * The label changes to confirm what happened — a copy button that looks
 * identical before and after leaves you wondering whether it worked.
 */
export function CopyPill({
  value,
  label,
  prefix,
}: {
  value: string;
  label: string;
  prefix?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable over plain http and in some embeds.
      // The value is on screen either way, so this degrades to a no-op.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${value}`}
      className={`${base} gap-2 border border-ink/20 bg-transparent text-ink/80 hover:bg-pill hover:text-ink`}
    >
      {prefix && <span className="text-ink/55">{prefix}</span>}
      <span className="underline underline-offset-[3px] decoration-ink/35">
        {copied ? 'copied' : label}
      </span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        aria-hidden="true"
        className="shrink-0 opacity-60"
      >
        <rect x="3.2" y="3.2" width="6.4" height="6.4" rx="1" />
        <path d="M2.4 8.2V2.4a1 1 0 0 1 1-1h5.8" />
      </svg>
    </button>
  );
}
