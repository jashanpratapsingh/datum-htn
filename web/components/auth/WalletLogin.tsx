'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { usePhantom } from '@/components/wallet/WalletProvider';

/**
 * Phantom as the first sign-in option on /login. The same provider that
 * powers the navbar pill does the signing; /api/auth/verify opens a Supabase
 * session alongside the wallet cookie, so once `status` turns connected the
 * server sees a signed-in viewer and we can move on to `next`.
 */
export default function WalletLogin({ next }: { next: string }) {
  const wallet = usePhantom();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (wallet.status === 'connected' && !redirected.current) {
      redirected.current = true;
      router.replace(next);
      router.refresh();
    }
  }, [wallet.status, next, router]);

  const busy = wallet.status === 'connecting' || wallet.status === 'idle';
  const noPhantom = wallet.status === 'no-phantom';

  return (
    <div className="panel mx-auto w-full max-w-md" data-wallet-login={wallet.status}>
      <div className="flex flex-col gap-4 px-5 py-6">
        <div>
          <p className="plate mb-1">wallet</p>
          <p className="text-[15px] leading-snug text-ink">Sign in with Phantom. One signature, no transaction, no fee.</p>
        </div>
        {noPhantom ? (
          <a
            href="https://phantom.app/download"
            target="_blank"
            rel="noopener noreferrer"
            className="readout inline-flex items-center justify-center rounded-full border border-ink px-6 py-2.5 text-sm text-ink transition-colors hover:bg-ink hover:text-canvas"
          >
            Get Phantom
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void wallet.connect()}
            disabled={busy || wallet.status === 'connected'}
            className="readout inline-flex items-center justify-center rounded-full border border-ink bg-ink px-6 py-2.5 text-sm text-canvas transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {wallet.status === 'connecting' ? 'Waiting for Phantom…' : wallet.status === 'connected' ? 'Signed in' : 'Connect Phantom'}
          </button>
        )}
        {wallet.error && (
          <p className="border-l-2 border-alarm px-3 py-1.5 text-sm text-alarm" role="alert">
            {wallet.error}
          </p>
        )}
      </div>
    </div>
  );
}
