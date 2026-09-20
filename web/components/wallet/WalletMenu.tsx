'use client';

/**
 * What opens under the connected pill: the full address, the detected devnet
 * balances, the derived role, and Disconnect. A panel, divided by hairlines,
 * like every other panel on the site.
 */

import { useEffect, useRef } from 'react';
import { CopyPill } from '@/components/Pill';
import { compositeId, getRelay } from '@/lib/relays';
import { usePhantom } from './WalletProvider';

const LAMPORTS_PER_SOL = 1_000_000_000;

function fmtSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}

function fmtUsdc(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, '0');
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

export function WalletMenu({ id, floating, onClose }: { id: string; floating: boolean; onClose: () => void }) {
  const w = usePhantom();
  const firstRef = useRef<HTMLButtonElement>(null);
  const wallet = w.wallet ?? '';

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      id={id}
      role="dialog"
      aria-label="Wallet"
      className={`panel text-left ${floating ? 'absolute right-0 top-full z-[80] mt-2 w-[19rem]' : 'w-full max-w-sm'}`}
      data-wallet="menu"
    >
      <div className="px-4 py-3">
        <div className="plate">Phantom · Solana devnet</div>
        <div className="readout mt-1 break-all text-[13px] text-ink" data-wallet="full-address">
          {wallet}
        </div>
        <div className="mt-2 -mb-[0.5em]">
          <CopyPill value={wallet} label="copy address" />
        </div>
      </div>

      <div className="panel-divide grid grid-cols-2">
        <div className="px-4 py-3">
          <div className="plate">SOL</div>
          <div className="readout text-[15px] text-ink" data-wallet="menu-sol">
            {w.balances ? `◎ ${fmtSol(w.balances.lamports)}` : '—'}
          </div>
        </div>
        <div className="panel-divide-x px-4 py-3">
          <div className="plate">USDC</div>
          <div className="readout text-[15px] text-ink" data-wallet="menu-usdc">
            {w.balances ? fmtUsdc(w.balances.usdcMicro) : '—'}
          </div>
        </div>
      </div>
      {w.balancesError && (
        <div className="panel-divide px-4 py-2 plate text-alarm">{w.balancesError}</div>
      )}

      <div className="panel-divide px-4 py-3">
        <div className="plate">Role</div>
        <div className="text-[15px] text-ink" data-wallet="role">
          {w.role === 'vendor' ? (
            <>
              vendor · {w.devices.length} device{w.devices.length === 1 ? '' : 's'}
            </>
          ) : w.role === 'visitor' ? (
            'visitor'
          ) : (
            '—'
          )}
        </div>
        {w.role === 'vendor' && w.devices.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {w.devices.slice(0, 4).map((d) => {
              const relay = getRelay(d.relayKey);
              const href = relay ? `/devices/${encodeURIComponent(compositeId(relay, d.id))}` : `/devices/${encodeURIComponent(d.id)}`;
              return (
                <li key={`${d.relayKey}:${d.id}`}>
                  <a href={href} className="readout text-[13px] text-ink underline underline-offset-[3px] decoration-ink/35 hover:decoration-ink">
                    {d.id}
                  </a>
                  {d.nodeState && <span className="plate ml-2 inline">{d.nodeState}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {w.warning === 'accounts_unavailable' && (
          <div className="plate mt-1">signed in; account store unavailable</div>
        )}
        {!w.providerReady && (
          <div className="plate mt-1">Phantom not attached in this tab — reconnect to pay</div>
        )}
      </div>

      <div className="panel-divide flex items-center justify-between gap-3 px-4 py-3">
        <a
          href={`https://explorer.solana.com/address/${wallet}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="text-[13px] text-ink underline underline-offset-[3px] decoration-ink/35 hover:decoration-ink"
        >
          Explorer
        </a>
        <button
          ref={firstRef}
          type="button"
          onClick={() => {
            onClose();
            void w.disconnect();
          }}
          className="readout inline-flex items-center rounded-full border border-ink bg-ink px-4 py-1.5 text-[13px] text-canvas transition-colors duration-150 hover:bg-transparent hover:text-ink"
          data-wallet="disconnect"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
