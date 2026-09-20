'use client';

import { useState } from 'react';
import { usePhantom } from '@/components/wallet/WalletProvider';
import { isUserRejection } from '@/lib/wallet/phantom';
import { CopyPill } from '@/components/Pill';

interface Props {
  agentId: string;
  walletPubkey: string;
  /** Where to send the user afterwards (the client's redirect_uri with the code), or null on the dashboard. */
  back: string | null;
  clientName?: string;
}

const PRESETS = [
  { usdc: '0.10', sol: 0.005 },
  { usdc: '0.50', sol: 0.01 },
  { usdc: '2.00', sol: 0.02 },
];

/**
 * Top up an agent wallet from the viewer's Phantom: one transaction moving
 * USDC (what readings cost) and a little SOL (what transactions cost). The
 * balance shown afterwards is read back from the chain, not assumed.
 */
export default function FundAgentWallet({ agentId, walletPubkey, back, clientName }: Props) {
  const wallet = usePhantom();
  const [usdc, setUsdc] = useState('0.50');
  const [sol, setSol] = useState(0.01);
  const [phase, setPhase] = useState<'idle' | 'signing' | 'sent' | 'done' | 'error'>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [balance, setBalance] = useState<{ usdc: string; sol: string } | null>(null);
  const live = wallet.status === 'connected' && wallet.providerReady && !!wallet.provider && !!wallet.wallet;

  async function refresh() {
    const solana = await import('@/lib/wallet/solana');
    const b = await solana.fetchBalances(walletPubkey);
    setBalance({ usdc: solana.formatUsdc(b.usdcMicro), sol: solana.formatSol(b.lamports) });
  }

  async function fund() {
    if (!live || !wallet.provider || !wallet.wallet) return;
    setPhase('signing');
    setDetail(null);
    try {
      const solana = await import('@/lib/wallet/solana');
      const micro = solana.usdToMicroSafe(usdc);
      if (micro === null) throw new Error('USDC amount must look like 0.50');
      const res = await solana.fundWithPhantom(
        wallet.provider,
        { payer: wallet.wallet, to: walletPubkey, usdcMicro: micro.toString(), lamports: Math.round(sol * 1e9), memo: `vendx-fund:${agentId}`, network: 'solana-devnet' },
        (sig) => {
          setPhase('sent');
          setDetail(`sent ${sig.slice(0, 16)}… awaiting confirmation`);
        },
      );
      setPhase('done');
      setDetail(res.explorer);
      void wallet.refreshBalances();
      await refresh();
    } catch (e) {
      setPhase('error');
      const solana = await import('@/lib/wallet/solana');
      setDetail(isUserRejection(e) ? 'Rejected in Phantom' : solana.describePaymentError(e));
    }
  }

  return (
    <div className="panel mx-auto w-full max-w-xl" data-fund={phase}>
      <div className="flex flex-col gap-2 px-5 py-5">
        <p className="plate">agent wallet · devnet</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="readout break-all text-sm text-ink">{walletPubkey}</span>
          <CopyPill value={walletPubkey} label="copy" />
        </div>
        <p className="text-sm text-ink-muted">
          Held for this connection, sealed at rest. Readings are paid from here; the balance is the agent&apos;s hard budget. {balance ? `Now: ${balance.usdc} USDC · ${balance.sol} SOL.` : ''}
        </p>
      </div>

      <div className="panel-divide flex flex-col gap-3 px-5 py-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Amount">
          {PRESETS.map((p) => (
            <button
              key={p.usdc}
              type="button"
              role="radio"
              aria-checked={usdc === p.usdc}
              onClick={() => {
                setUsdc(p.usdc);
                setSol(p.sol);
              }}
              className={`readout rounded-full border px-3 py-1 text-xs transition-colors ${usdc === p.usdc ? 'border-ink bg-ink text-canvas' : 'border-rule text-ink-muted hover:border-ink hover:text-ink'}`}
            >
              {p.usdc} USDC + {p.sol} SOL
            </button>
          ))}
        </div>
        {live ? (
          <button
            type="button"
            onClick={() => void fund()}
            disabled={phase === 'signing' || phase === 'sent'}
            className="readout inline-flex items-center justify-center self-start rounded-full border border-ink bg-ink px-6 py-2.5 text-sm text-canvas transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === 'signing' ? 'Waiting for Phantom…' : phase === 'sent' ? 'Confirming on devnet…' : `Fund ${usdc} USDC from Phantom`}
          </button>
        ) : (
          <p className="text-sm text-ink-muted">
            Connect Phantom (top right) to fund from your wallet, or send devnet USDC and SOL to the address above from anywhere.
          </p>
        )}
        {detail && (
          <p className={`readout break-all text-xs ${phase === 'error' ? 'text-alarm' : 'text-ink-muted'}`} role={phase === 'error' ? 'alert' : undefined}>
            {phase === 'done' ? (
              <>
                funded ·{' '}
                <a href={detail} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                  solscan
                </a>
              </>
            ) : (
              detail
            )}
          </p>
        )}
      </div>

      {back && (
        <div className="panel-divide flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <span className="text-sm text-ink-muted">{phase === 'done' ? 'Funded.' : 'You can fund later from your account.'}</span>
          <a href={back} className="readout inline-flex items-center justify-center rounded-full border border-ink px-6 py-2.5 text-sm text-ink transition-colors hover:bg-ink hover:text-canvas" data-fund-continue>
            Continue to {clientName ?? 'your agent'} →
          </a>
        </div>
      )}
    </div>
  );
}
