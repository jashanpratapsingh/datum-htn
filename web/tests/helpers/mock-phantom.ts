/**
 * A Phantom stand-in for Playwright.
 *
 * The real extension cannot be driven headlessly, so the page gets a
 * `window.phantom.solana` that behaves like Phantom's injected provider —
 * connect / onlyIfTrusted / disconnect / signIn / signMessage / events — and
 * signs with a REAL Ed25519 key held on the Node side. The server therefore
 * verifies genuine signatures over genuine SIWS text; only the popup is faked.
 *
 * The SIWS text is built by the same `buildSiwsMessage` the server uses,
 * injected as source, so the mock cannot drift from the real format.
 *
 * With `payments: true`, `signAndSendTransaction` serializes the transaction,
 * Node signs it with the same key and sends it to devnet. That is a real
 * payment; only use it with a funded key (VENDX_E2E_KEYPAIR).
 */

import type { Page } from '@playwright/test';
import nacl from 'tweetnacl';
import { Connection, Keypair, Transaction } from '@solana/web3.js';
import { buildSiwsMessage } from '../../lib/wallet/siws';

export interface MockPhantomOptions {
  keypair?: Keypair;
  /** Start already trusted (as if the user connected on an earlier visit). */
  trusted?: boolean;
  /** Enable real devnet sends from signAndSendTransaction. */
  payments?: boolean;
  rpcUrl?: string;
}

export interface MockPhantom {
  address: string;
  keypair: Keypair;
}

let exposedSign = new WeakSet<Page>();

export async function installMockPhantom(page: Page, opts: MockPhantomOptions = {}): Promise<MockPhantom> {
  const keypair = opts.keypair ?? Keypair.generate();
  const address = keypair.publicKey.toBase58();

  if (!exposedSign.has(page)) {
    exposedSign.add(page);
    await page.exposeFunction('__vendxSign', (b64: string) =>
      Buffer.from(nacl.sign.detached(Buffer.from(b64, 'base64'), keypair.secretKey)).toString('base64'),
    );
    if (opts.payments) {
      const conn = new Connection(opts.rpcUrl ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
      await page.exposeFunction('__vendxSendTx', async (b64: string) => {
        const tx = Transaction.from(Buffer.from(b64, 'base64'));
        tx.partialSign(keypair);
        return conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
      });
    }
  }

  const installer = (args: { address: string; trusted: boolean }, buildSiws: (i: Record<string, unknown>) => string) => {
    const TRUST_KEY = '__mockPhantomTrusted';
    const listeners: Record<string, Array<(a?: unknown) => void>> = {};
    const emit = (ev: string, a?: unknown) => (listeners[ev] ?? []).forEach((h) => h(a));
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const pk = { toBase58: () => args.address, toString: () => args.address };
    if (args.trusted) localStorage.setItem(TRUST_KEY, '1');

    type W = {
      __vendxSign: (b: string) => Promise<string>;
      __vendxSendTx?: (b: string) => Promise<string>;
      __mockPhantomEmit?: (ev: string, a?: unknown) => void;
      phantom?: unknown;
    };
    const w = window as unknown as W;

    const mock = {
      isPhantom: true,
      publicKey: null as typeof pk | null,
      isConnected: false,
      async connect(o?: { onlyIfTrusted?: boolean }) {
        if (o?.onlyIfTrusted && localStorage.getItem(TRUST_KEY) !== '1') {
          const e = Object.assign(new Error('User rejected the request.'), { code: 4001 });
          throw e;
        }
        this.publicKey = pk;
        this.isConnected = true;
        localStorage.setItem(TRUST_KEY, '1');
        emit('connect', pk);
        return { publicKey: pk };
      },
      async disconnect() {
        this.publicKey = null;
        this.isConnected = false;
        localStorage.removeItem(TRUST_KEY);
        emit('disconnect');
      },
      async signIn(input: Record<string, unknown> = {}) {
        const text = buildSiws({ ...input, address: args.address });
        const bytes = new TextEncoder().encode(text);
        const signature = fromB64(await w.__vendxSign(b64(bytes)));
        this.publicKey = pk;
        this.isConnected = true;
        localStorage.setItem(TRUST_KEY, '1');
        emit('connect', pk);
        return { address: pk, signedMessage: bytes, signature };
      },
      async signMessage(bytes: Uint8Array) {
        const signature = fromB64(await w.__vendxSign(b64(bytes)));
        return { signature, publicKey: pk };
      },
      async signAndSendTransaction(tx: { serialize(o: { requireAllSignatures: boolean; verifySignatures: boolean }): Uint8Array }) {
        if (!w.__vendxSendTx) throw new Error('mock phantom: payments disabled in this test');
        const ser = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        const signature = await w.__vendxSendTx(b64(ser));
        return { signature };
      },
      on(ev: string, h: (a?: unknown) => void) {
        (listeners[ev] ??= []).push(h);
      },
      off(ev: string, h: (a?: unknown) => void) {
        listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== h);
      },
      removeListener(ev: string, h: (a?: unknown) => void) {
        this.off(ev, h);
      },
    };
    w.phantom = { solana: mock };
    w.__mockPhantomEmit = emit;
  };

  await page.addInitScript({
    content: `(${installer.toString()})(${JSON.stringify({ address, trusted: !!opts.trusted })}, ${buildSiwsMessage.toString()});`,
  });

  return { address, keypair };
}

/** Load a Solana CLI keypair file (JSON array of 64 bytes). */
export function loadKeypairFile(path: string): Keypair {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
