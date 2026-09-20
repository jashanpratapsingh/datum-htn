'use client';

/**
 * Phantom login state for the whole site.
 *
 * Login is a cookie (vendx_session) issued by /api/auth/verify after Phantom
 * signs a Sign In With Solana message. On a return visit the cookie restores
 * the session and Phantom is re-attached silently (`onlyIfTrusted`) so
 * balances and payments work without a click. If Phantom later reports a
 * different account, or the user disconnects in the extension, the site logs
 * out rather than showing one wallet while another would sign.
 *
 * web3.js is loaded on demand (`import('@/lib/wallet/solana')`) so this
 * provider, which wraps every page, stays small.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  bytesToB64u,
  getPhantom,
  isUserRejection,
  normalizeAddress,
  offEvent,
  waitForPhantom,
  type PhantomProvider,
} from '@/lib/wallet/phantom';
import type { SiwsInput } from '@/lib/wallet/siws';
import type { Balances } from '@/lib/wallet/solana';

export type WalletStatus = 'idle' | 'no-phantom' | 'disconnected' | 'connecting' | 'connected';
export type Role = 'vendor' | 'visitor';

export interface OwnedDevice {
  id: string;
  relayKey: string;
  relayLabel: string;
  source: string;
  nodeState?: string;
  url?: string;
}

export interface AccountInfo {
  wallet: string;
  first_seen: string;
  last_seen: string;
  login_count: number;
}

interface WalletState {
  status: WalletStatus;
  wallet: string | null;
  balances: Balances | null;
  balancesError: string | null;
  role: Role | null;
  devices: OwnedDevice[];
  account: AccountInfo | null;
  error: string | null;
  warning: string | null;
  /** Phantom is attached for this wallet (signing possible). */
  providerReady: boolean;
}

export interface WalletContextValue extends WalletState {
  provider: PhantomProvider | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  refreshBalances(): Promise<void>;
  refreshMe(): Promise<void>;
}

const initial: WalletState = {
  status: 'idle',
  wallet: null,
  balances: null,
  balancesError: null,
  role: null,
  devices: [],
  account: null,
  error: null,
  warning: null,
  providerReady: false,
};

const WalletContext = createContext<WalletContextValue | null>(null);

const BALANCE_INTERVAL_MS = 30_000;

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  const data = (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(initial);
  const router = useRouter();
  const providerRef = useRef<PhantomProvider | null>(null);
  const walletRef = useRef<string | null>(null);
  const backoffRef = useRef(0);
  walletRef.current = state.wallet;

  const patch = useCallback((p: Partial<WalletState>) => setState((s) => ({ ...s, ...p })), []);

  const logoutLocal = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
    patch({
      status: providerRef.current ? 'disconnected' : 'no-phantom',
      wallet: null,
      balances: null,
      balancesError: null,
      role: null,
      devices: [],
      account: null,
      providerReady: false,
    });
    // Server components (agent console, account, login redirect) read the
    // session from cookies: re-render them now that the cookies are gone.
    router.refresh();
  }, [patch, router]);

  const refreshBalances = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet) return;
    if (backoffRef.current > Date.now()) return;
    try {
      const { fetchBalances } = await import('@/lib/wallet/solana');
      const balances = await fetchBalances(wallet);
      if (walletRef.current !== wallet) return;
      patch({ balances, balancesError: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/429|Too Many Requests/i.test(msg)) backoffRef.current = Date.now() + 60_000;
      patch({ balancesError: 'balance lookup failed' });
    }
  }, [patch]);

  const refreshMe = useCallback(async () => {
    const res = await fetch('/api/me', { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) return;
    const me = (await res.json()) as { role: Role; devices: OwnedDevice[]; account: AccountInfo | null };
    patch({ role: me.role, devices: me.devices ?? [], account: me.account ?? null });
  }, [patch]);

  const connect = useCallback(async () => {
    const provider = getPhantom() ?? (await waitForPhantom(600));
    providerRef.current = provider;
    if (!provider) {
      patch({ status: 'no-phantom' });
      return;
    }
    patch({ status: 'connecting', error: null, warning: null });
    try {
      const nonce = await postJson<{ input: SiwsInput }>('/api/auth/nonce', {});
      if (nonce.status !== 200) throw new Error('could not start sign-in');

      let address: string | null;
      let signedMessage: Uint8Array;
      let signature: Uint8Array;
      let method: 'signIn' | 'signMessage';

      if (typeof provider.signIn === 'function') {
        const out = await provider.signIn(nonce.data.input);
        address = normalizeAddress(out.address ?? out.account?.address ?? provider.publicKey);
        signedMessage = out.signedMessage;
        signature = out.signature;
        method = 'signIn';
      } else {
        const { publicKey } = await provider.connect();
        address = normalizeAddress(publicKey);
        if (!address) throw new Error('Phantom returned no public key');
        const withAddr = await postJson<{ message: string }>('/api/auth/nonce', { address });
        if (withAddr.status !== 200 || !withAddr.data.message) throw new Error('could not build sign-in message');
        signedMessage = new TextEncoder().encode(withAddr.data.message);
        const signed = await provider.signMessage(signedMessage, 'utf8');
        signature = signed.signature;
        method = 'signMessage';
      }
      if (!address) throw new Error('Phantom returned no address');

      const verify = await postJson<{
        ok?: boolean;
        role?: Role;
        devices?: OwnedDevice[];
        account?: AccountInfo | null;
        warning?: string;
        error?: string;
        detail?: string;
      }>('/api/auth/verify', {
        address,
        signedMessage: bytesToB64u(signedMessage),
        signature: bytesToB64u(signature),
        method,
      });
      if (verify.status !== 200 || !verify.data.ok) {
        throw new Error(`sign-in rejected: ${verify.data.error ?? verify.status}${verify.data.detail ? ` (${verify.data.detail})` : ''}`);
      }
      walletRef.current = address;
      patch({
        status: 'connected',
        wallet: address,
        role: verify.data.role ?? 'visitor',
        devices: verify.data.devices ?? [],
        account: verify.data.account ?? null,
        warning: verify.data.warning ?? null,
        providerReady: true,
        error: null,
      });
      void refreshBalances();
      // The verify response set the session cookies; let every server
      // component on the page see the signed-in viewer without a reload.
      router.refresh();
    } catch (e) {
      patch({
        status: 'disconnected',
        error: isUserRejection(e) ? 'Cancelled in Phantom' : e instanceof Error ? e.message : String(e),
      });
    }
  }, [patch, refreshBalances, router]);

  const disconnect = useCallback(async () => {
    const p = providerRef.current;
    await logoutLocal();
    if (p && p.isConnected) await p.disconnect().catch(() => undefined);
  }, [logoutLocal]);

  // Mount: restore the cookie session and re-attach Phantom silently.
  useEffect(() => {
    let cancelled = false;
    const handlers: Array<[PhantomProvider, 'accountChanged' | 'disconnect', (arg?: unknown) => void]> = [];

    (async () => {
      const session = await fetch('/api/auth/session', { cache: 'no-store' })
        .then((r) => r.json() as Promise<{ authenticated: boolean; wallet?: string }>)
        .catch(() => ({ authenticated: false as const }));
      const provider = await waitForPhantom();
      if (cancelled) return;
      providerRef.current = provider;

      if (!provider) {
        if (session.authenticated && session.wallet) {
          walletRef.current = session.wallet;
          patch({ status: 'connected', wallet: session.wallet, providerReady: false });
          void refreshMe();
          void refreshBalances();
        } else {
          patch({ status: 'no-phantom' });
        }
        return;
      }

      const onAccountChanged = (arg?: unknown) => {
        const next = normalizeAddress(arg);
        if (next && walletRef.current && next !== walletRef.current) void logoutLocal();
      };
      const onDisconnect = () => {
        if (walletRef.current) void logoutLocal();
      };
      provider.on('accountChanged', onAccountChanged);
      provider.on('disconnect', onDisconnect);
      handlers.push([provider, 'accountChanged', onAccountChanged], [provider, 'disconnect', onDisconnect]);

      if (!session.authenticated || !session.wallet) {
        patch({ status: 'disconnected' });
        return;
      }

      let attached = false;
      try {
        await provider.connect({ onlyIfTrusted: true });
        attached = true;
      } catch {
        attached = false;
      }
      if (cancelled) return;
      const current = attached ? normalizeAddress(provider.publicKey) : null;
      if (attached && current && current !== session.wallet) {
        await logoutLocal();
        return;
      }
      walletRef.current = session.wallet;
      patch({ status: 'connected', wallet: session.wallet, providerReady: attached });
      void refreshMe();
      void refreshBalances();
    })();

    return () => {
      cancelled = true;
      for (const [p, ev, h] of handlers) offEvent(p, ev, h);
    };
  }, [patch, refreshMe, refreshBalances, logoutLocal]);

  // Balance polling while connected and visible.
  useEffect(() => {
    if (state.status !== 'connected' || !state.wallet) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void refreshBalances();
    };
    const id = setInterval(tick, BALANCE_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [state.status, state.wallet, refreshBalances]);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, provider: providerRef.current, connect, disconnect, refreshBalances, refreshMe }),
    [state, connect, disconnect, refreshBalances, refreshMe],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function usePhantom(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('usePhantom must be used inside <WalletProvider>');
  return ctx;
}
