import { createServer } from 'node:http';
import { Keypair } from '@solana/web3.js';
import {
  NonceStore,
  buildChallenge,
  encodeSettleHeader,
  explainFailure,
  loadOrCreateWallet,
  usdcMintFor,
  verifyPaymentReceipt,
  walletPath,
  type PaymentRequiredBody,
  type Provenance,
} from '@vendx/protocol';

import { Books } from './books.js';
import { describeConfig, loadConfig, type Config } from './config.js';
import { header, pathOf, sendJson, sendPaymentRequired } from './http.js';
import { getKeys } from './keys.js';
import { quote } from './pricing.js';
import { Sensor } from './sensor.js';

/**
 * The VENDX node: the thing that actually refuses to hand over data.
 *
 * Runs alongside the simulator relay (`server.ts`, port 3402) rather than
 * replacing it. Same protocol, same receipt format, same facilitator key — the
 * difference is that this one reads a real radio, prices itself, keeps books, and
 * is paid with real devnet USDC.
 *
 * It owns the nonces it mints, so replay defence needs no payment history and no
 * RPC call — the design that lets this same state machine move onto an ESP32
 * later (see docs/PROTOCOL.md).
 */

export interface NodeDeps {
  config: Config;
  sensor: Sensor;
  /** The vendor wallet that must be paid. */
  payTo: string;
  /** Facilitator's Ed25519 public key, for offline receipt verification. */
  facilitatorPubkey: Uint8Array;
  books: Books;
}

export function createNode(deps: NodeDeps) {
  const { config, sensor, payTo, facilitatorPubkey, books } = deps;

  const nonces = new NonceStore({ ttlSeconds: 300 });
  /** Request timestamps, for the demand term in pricing. */
  const requestLog: number[] = [];
  /**
   * The price quoted alongside each outstanding nonce.
   *
   * Without this, a buyer could be quoted one price, pay it, and then be judged
   * against a price that moved in between — the pricer is time-varying by design,
   * so the quote has to be pinned to the nonce it was issued with.
   */
  const quoted = new Map<string, string>();
  let served = 0;
  let refused = 0;

  function currentQuote() {
    const status = sensor.status();
    return quote({
      now: Date.now(),
      lastSaleAt: books.lastSaleAt,
      recentRequests: requestLog,
      bssidCount: status.bssidCount,
      provenance: status.provenance,
      warmingUp: status.warmingUp,
    });
  }

  const server = createServer((req, res) => {
    const path = pathOf(req);

    try {
      if (req.method === 'GET' && path === '/api/stats') {
        sendJson(res, 200, {
          nodeId: config.nodeId,
          payTo,
          network: config.network,
          settlement: config.settlement,
          sensor: sensor.status(),
          price: currentQuote(),
          books: books.snapshot(),
          nonces: { outstanding: nonces.outstanding(), capacity: nonces.capacity },
          served,
          refused,
        });
        return;
      }

      if (req.method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true, tier: sensor.status().provenance });
        return;
      }

      if (req.method !== 'GET' || path !== config.resource) {
        sendJson(res, 404, { error: 'not_found', path });
        return;
      }

      // --- the paid resource -------------------------------------------
      const ledger = books.snapshot();
      if (ledger.insolvent) {
        // The sensor cannot pay its own bills, so it stops trading. A real
        // state, not a simulated one: it clears as soon as revenue covers it.
        refused++;
        sendJson(res, 503, {
          error: 'insolvent',
          detail: 'node cannot cover its next operating payment and has suspended service',
          books: ledger,
        });
        return;
      }

      const receiptHeader = header(req, 'x-payment-receipt');

      if (receiptHeader === null) {
        // No receipt: quote a price and mint a nonce bound to it.
        requestLog.push(Date.now());
        if (requestLog.length > 256) requestLog.splice(0, requestLog.length - 256);

        const q = currentQuote();
        const challenge: PaymentRequiredBody = buildChallenge({
          resource: config.resource,
          description: `live foot traffic — ${q.rationale}`,
          priceUsd: q.usd,
          payTo,
          network: config.network,
          ttlSeconds: 300,
        });

        // Replace the library-minted nonce with one from our own store, so the
        // device is the sole issuer and can burn it on redemption.
        const issued = nonces.issue();
        challenge.nonce = issued.nonce;
        challenge.expiresAt = issued.expiresAt;
        quoted.set(issued.nonce, q.microUsdc);

        refused++;
        sendPaymentRequired(res, {
          ...challenge,
          vendx: {
            priceUsd: q.usd,
            priceMicroUsdc: q.microUsdc,
            pricing: q.rationale,
            settleWith: `${config.facilitatorUrl}/settle`,
            asset: usdcMintFor(config.network),
            /** Memo binding is mandatory: see relay-proxy/src/settlement.ts. */
            requireMemoNonce: true,
            sensor: sensor.status(),
          },
        });
        return;
      }

      // A receipt was presented. Judge it against the price we actually quoted.
      const claimedNonce = peekNonce(receiptHeader);
      const priceForNonce = (claimedNonce && quoted.get(claimedNonce)) ?? currentQuote().microUsdc;

      const verdict = verifyPaymentReceipt(receiptHeader, {
        facilitatorPubkey,
        payTo,
        priceMicroUsdc: priceForNonce,
        network: config.network,
        nonces,
      });

      if (!verdict.ok || !verdict.receipt) {
        refused++;
        const reason = verdict.reason ?? 'malformed_header';
        sendJson(res, 402, { error: reason, detail: explainFailure(reason) });
        return;
      }

      const receipt = verdict.receipt;
      quoted.delete(receipt.nonce);
      books.recordSale({
        microUsdc: BigInt(receipt.amount),
        nonce: receipt.nonce,
        payer: null,
        txSignature: receipt.signature,
      });
      served++;

      sendJson(res, 200, sensor.read(), {
        'x-payment-response': encodeSettleHeader({
          success: true,
          transaction: receipt.signature,
          network: receipt.network,
          payer: null,
        }),
      });
    } catch (e) {
      sendJson(res, 500, { error: 'internal', detail: (e as Error).message });
    }
  });

  return { server, nonces, books, currentQuote };
}

/**
 * Read the nonce out of a receipt WITHOUT trusting it.
 *
 * Used only to look up which price we quoted. The authoritative nonce comes from
 * the signature-verified body inside `verifyPaymentReceipt`; a wrong guess here
 * makes verification fail, which is the safe direction to be wrong in.
 */
function peekNonce(receiptHeader: string): string | null {
  try {
    const dot = receiptHeader.indexOf('.');
    if (dot <= 0) return null;
    const json = Buffer.from(receiptHeader.slice(0, dot), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { nonce?: unknown };
    return typeof parsed.nonce === 'string' ? parsed.nonce : null;
  } catch {
    return null;
  }
}

function main(): void {
  const config = loadConfig();

  const vendor = loadOrCreateWallet(walletPath('vendor', config.repoRoot));
  const payTo = Keypair.fromSecretKey(vendor.secretKey).publicKey.toBase58();

  const forced = process.env['VENDX_FORCE_TIER'];
  const sensor = new Sensor({
    nodeId: config.nodeId,
    resource: config.resource,
    ...(forced ? { forceProvenance: forced as Provenance } : {}),
  });
  sensor.start();

  const books = new Books();

  // The node pays its own operating costs out of revenue.
  setInterval(() => {
    void books.settleBill(async (micro) => ({
      onChain: false,
      txSignature: null,
      note: `operating cost ${micro} micro-USDC booked (${config.settlement} settlement)`,
    }));
  }, 5_000).unref();

  const { server } = createNode({
    config,
    sensor,
    payTo,
    facilitatorPubkey: getKeys().publicKey,
    books,
  });

  server.listen(config.nodePort, () => {
    const s = sensor.status();
    console.log(`[node] :${config.nodePort}  ${describeConfig(config)}`);
    console.log(`[node] wallet ${payTo}`);
    console.log(`[node] serving ${config.resource}`);
    console.log(`[node] sensor ${s.provenance} — ${s.note}`);
  });

  const shutdown = (): void => {
    sensor.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('node.js')) {
  main();
}
