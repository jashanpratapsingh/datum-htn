'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { label: 'Devices', href: '/devices' },
  { label: 'Marketplace', href: '/marketplace' },
  { label: 'Agent', href: '/agent' },
  { label: 'Policy', href: '/policy' },
  { label: 'Ledger', href: '/ledger' },
  { label: 'Protocol', href: '/protocol' },
  { label: 'Docs', href: '/docs' },
];

export default function NavBar() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;

    // Move focus into the menu when it opens
    firstLinkRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }

      // Focus trap: keep Tab inside the overlay
      if (e.key === 'Tab' && menuRef.current) {
        const focusable = Array.from(
          menuRef.current.querySelectorAll<HTMLElement>(
            'a[href], button, [tabindex]:not([tabindex="-1"])',
          ),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 lg:px-12 py-6">
      {/* Logo */}
      <a
        href="/"
        className="text-white font-[family-name:var(--font-inter)] font-extrabold text-xl tracking-tight"
        aria-label="VENDX home"
      >
        VENDX
      </a>

      {/* Desktop nav */}
      <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-8">
        {NAV_LINKS.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            className="font-[family-name:var(--font-inter)] text-base text-white/80 hover:text-[#5ed29c] transition-colors duration-200"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* Mobile hamburger */}
      <button
        className="md:hidden text-white p-2 -mr-2"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen(true)}
      >
        <Menu size={24} />
      </button>

      {/* Mobile overlay */}
      {open && (
        <div
          id="mobile-menu"
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-0 z-50 bg-[#070b0a]/95 flex flex-col items-center justify-center gap-8 md:hidden"
        >
          <button
            className="absolute top-6 right-6 text-white p-2"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          >
            <X size={24} />
          </button>

          <nav className="flex flex-col items-center gap-8">
            {NAV_LINKS.map(({ label, href }, i) => (
              <a
                key={label}
                href={href}
                ref={i === 0 ? firstLinkRef : undefined}
                className="font-[family-name:var(--font-inter)] text-2xl text-white hover:text-[#5ed29c] transition-colors duration-200"
                onClick={() => setOpen(false)}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
