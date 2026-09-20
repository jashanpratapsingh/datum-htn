/**
 * The Phantom injected provider, typed to the surface we use.
 *
 * Phantom only — no wallet adapter. The provider lives at
 * `window.phantom.solana` and is injected asynchronously, so `getPhantom()`
 * may be null on the first tick after load; `waitForPhantom()` retries briefly.
 *
 * Docs: https://docs.phantom.com/solana/ (connect, signMessage, signIn,
 * signAndSendTransaction, events). `signIn` returns the exact SIWS bytes it
 * signed; its `address` has been a PublicKey-like object in the injected
 * provider and a string in the wallet-standard shape, so it is normalized.
 */

import type { SendOptions, Transaction } from '@solana/web3.js';
import type { SiwsInput } from './siws';

export interface PublicKeyLike {
  toBase58(): string;
  toBytes?(): Uint8Array;
  toString(): string;
}

export interface PhantomSignInOutput {
  address?: PublicKeyLike | string;
  account?: { address: string; publicKey?: Uint8Array };
  signedMessage: Uint8Array;
  signature: Uint8Array;
}

export type PhantomEvent = 'connect' | 'disconnect' | 'accountChanged';

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: PublicKeyLike | null;
  isConnected: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKeyLike }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<{ signature: Uint8Array; publicKey?: PublicKeyLike }>;
  signIn?(input?: SiwsInput): Promise<PhantomSignInOutput>;
  signAndSendTransaction(tx: Transaction, opts?: SendOptions): Promise<{ signature: string }>;
  on(event: PhantomEvent, handler: (arg?: unknown) => void): void;
  off?(event: PhantomEvent, handler: (arg?: unknown) => void): void;
  removeListener?(event: PhantomEvent, handler: (arg?: unknown) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

export const PHANTOM_INSTALL_URL = 'https://phantom.app/download';

export function getPhantom(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  const p = window.phantom?.solana;
  return p && p.isPhantom !== false ? p : null;
}

/** Phantom injects after the document loads; poll briefly before declaring it absent. */
export async function waitForPhantom(maxMs = 1200): Promise<PhantomProvider | null> {
  const start = Date.now();
  let p = getPhantom();
  while (!p && Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 100));
    p = getPhantom();
  }
  return p;
}

export function normalizeAddress(a: unknown): string | null {
  if (!a) return null;
  if (typeof a === 'string') return a;
  if (typeof a === 'object') {
    const o = a as Partial<PublicKeyLike> & { address?: unknown };
    if (typeof o.toBase58 === 'function') return o.toBase58();
    if (typeof o.address === 'string') return o.address;
    if (typeof o.toString === 'function') {
      const s = o.toString();
      if (s && s !== '[object Object]') return s;
    }
  }
  return null;
}

/** Phantom rejects with code 4001 when the user closes or declines the popup. */
export function isUserRejection(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: unknown; message?: unknown };
  if (err.code === 4001) return true;
  return typeof err.message === 'string' && /user rejected|rejected the request|cancell?ed/i.test(err.message);
}

export function bytesToB64u(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function offEvent(p: PhantomProvider, event: PhantomEvent, handler: (arg?: unknown) => void): void {
  if (typeof p.off === 'function') p.off(event, handler);
  else if (typeof p.removeListener === 'function') p.removeListener(event, handler);
}
