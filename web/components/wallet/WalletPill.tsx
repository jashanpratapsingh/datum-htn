'use client';

/**
 * The one wallet control on the site: a pill in the navbar.
 *
 *   idle          ···                       (server render + first paint, no layout jump)
 *   no-phantom    Get Phantom               (link to the extension)
 *   disconnected  Connect Phantom
 *   connecting    Signing…                  (disabled while the popup is open)
 *   connected     7xKp…9fQ2 · ◎ 1.204 · 12.50 USDC   (opens the menu)
 *
 * `variant="menu"` is the mobile overlay: same pill, menu rendered inline
 * below it rather than floating.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { pillBase } from '@/components/Pill';
import { PHANTOM_INSTALL_URL } from '@/lib/wallet/phantom';
import { shortAddress } from '@/lib/wallet/siws';
import { usePhantom } from './WalletProvider';
import { WalletMenu } from './WalletMenu';

const LAMPORTS_PER_SOL = 1_000_000_000;

function fmtSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  return sol >= 100 ? sol.toFixed(1) : sol >= 1 ? sol.toFixed(3) : sol.toFixed(4);
}

function fmtUsdc(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

const filled = `${pillBase} bg-pill text-ink hover:bg-ink hover:text-pill`;

export function WalletPill({ variant = 'popover' }: { variant?: 'popover' | 'menu' }) {
  const w = usePhantom();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close the floating menu on outside click or Escape.
  useEffect(() => {
    if (!open || variant !== 'popover') return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, variant]);

  useEffect(() => {
    if (w.status !== 'connected') setOpen(false);
  }, [w.status]);

  if (w.status === 'idle') {
    return (
      <span className={`${filled} readout min-w-[9.5em] text-ink/50`} aria-busy="true" aria-label="Wallet loading">
        ···
      </span>
    );
  }

  if (w.status === 'no-phantom') {
    return (
      <a href={PHANTOM_INSTALL_URL} target="_blank" rel="noreferrer" className={filled} data-wallet="get-phantom">
        Get Phantom
      </a>
    );
  }

  if (w.status === 'disconnected' || w.status === 'connecting') {
    const busy = w.status === 'connecting';
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void w.connect()}
          disabled={busy}
          aria-busy={busy}
          className={`${filled} disabled:cursor-wait disabled:opacity-60`}
          data-wallet="connect"
        >
          {busy ? 'Signing…' : 'Connect Phantom'}
        </button>
        {w.error && (
          <span role="status" className="plate text-alarm" data-wallet="error">
            {w.error}
          </span>
        )}
      </span>
    );
  }

  const wallet = w.wallet ?? '';
  return (
    <div ref={wrapRef} className={variant === 'popover' ? 'relative' : 'flex flex-col gap-3'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        className={`${filled} gap-2`}
        data-wallet="connected"
        title={wallet}
      >
        <span className="readout" data-wallet="address">
          {shortAddress(wallet)}
        </span>
        {w.balances && (
          <>
            <span aria-hidden="true" className="hidden text-ink/35 sm:inline">
              ·
            </span>
            <span className="readout hidden sm:inline" data-wallet="sol">
              ◎ {fmtSol(w.balances.lamports)}
            </span>
            <span className="readout hidden sm:inline" data-wallet="usdc">
              {fmtUsdc(w.balances.usdcMicro)} USDC
            </span>
          </>
        )}
      </button>
      {open && <WalletMenu id={menuId} floating={variant === 'popover'} onClose={() => setOpen(false)} />}
    </div>
  );
}
