'use client';

import { useEffect, useRef, useState } from 'react';
import { WalletPill } from '@/components/wallet/WalletPill';

const LINKS = [
  { href: '/devices', label: 'Devices' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/agent', label: 'Agent' },
  { href: '/policy', label: 'Policy' },
  { href: '/ledger', label: 'Ledger' },
  { href: '/protocol', label: 'Protocol' },
  { href: '/docs', label: 'Docs' },
];

export default function NavBar() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !menuRef.current) return;
      const focusables = menuRef.current.querySelectorAll<HTMLElement>(
        'a[href], button, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <header className={`absolute left-0 right-0 top-0 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5 ${open ? 'z-[70]' : 'z-50'}`}>
        <a
          href="/"
          aria-label="VENDX home"
          className="flex items-center gap-3 text-ink hover:text-ink/75 transition-colors"
        >
          <span className="text-[21px] tracking-tight sm:text-[24px]">
            VENDX<sup className="text-[0.5em] align-super">®</sup>
          </span>
          <span
            aria-hidden="true"
            className="select-none text-[25px] text-ink/55 sm:text-[30px]"
            style={{ letterSpacing: '-0.02em' }}
          >
            ✳︎
          </span>
        </a>

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-x-[0.45em] md:flex text-[15px] text-ink"
        >
          {LINKS.map((l, i) => (
            <span key={l.href}>
              <a href={l.href} className="hover:text-ink-muted transition-colors">
                {l.label}
              </a>
              {i < LINKS.length - 1 && <span className="text-ink/35">,</span>}
            </span>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <a
            href="mailto:hello@vendx.dev"
            className="text-[15px] text-ink underline underline-offset-4 decoration-ink/40 hover:decoration-ink"
          >
            Get in touch
          </a>
          <WalletPill />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          className="flex flex-col gap-[5px] p-1 md:hidden"
        >
          <span
            className={`h-[2px] w-6 bg-ink transition-transform duration-300 ${
              open ? 'translate-y-[7px] rotate-45' : ''
            }`}
          />
          <span
            className={`h-[2px] w-6 bg-ink transition-opacity duration-300 ${
              open ? 'opacity-0' : ''
            }`}
          />
          <span
            className={`h-[2px] w-6 bg-ink transition-transform duration-300 ${
              open ? '-translate-y-[7px] -rotate-45' : ''
            }`}
          />
        </button>
      </header>

      {/*
        Conditionally mounted, not faded with opacity. An opacity-0 overlay is
        still hit-testable and still "visible" to assistive tech and to the
        focus-trap test, which is exactly the bug this pattern usually ships.
      */}
      {open && (
        <div
          id="mobile-menu"
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-0 z-[60] flex flex-col justify-center gap-7 bg-canvas/97 px-8 backdrop-blur-sm md:hidden"
        >
          {LINKS.map((l, i) => (
            <a
              key={l.href}
              href={l.href}
              ref={i === 0 ? firstLinkRef : undefined}
              onClick={() => setOpen(false)}
              className="text-[32px] font-medium text-ink hover:text-ink/70 transition-colors"
            >
              {l.label}
            </a>
          ))}
          <div className="mt-1 self-start">
            <WalletPill variant="menu" />
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            className="mt-2 self-start text-[15px] text-ink/60 underline underline-offset-4 hover:text-ink"
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
