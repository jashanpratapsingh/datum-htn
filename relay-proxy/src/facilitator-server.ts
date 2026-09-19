import { createServer } from 'node:http';
import { Connection } from '@solana/web3.js';

import { settle } from './facilitator.js';
import { getKeys } from './keys.js';
import { describeConfig, loadConfig, type Config } from './config.js';
import { pathOf, readJsonBody, sendJson } from './http.js';
import { verifySettlement, type SettlementResult } from './settlement.js';

/**
 * A standalone facilitator that actually looks at the chain.
 *
 * This wraps, rather than replaces, `facilitator.ts`. That file already builds
 * and signs the receipt correctly and its own header notes the gap it leaves:
 * "in simulator mode it trusts the buyer's reported txSignature". So the split of
 * work here is:
 *
 *   settlement.ts   did the money actually move, on the right mint, to the right
 *                   wallet, for the right nonce?
 *   facilitator.ts  given that it did, sign the receipt.        (unchanged)
 *
 * Signing still uses `getKeys()`, the same `keys/facilitator.json` the simulator
 * relay uses, so both servers present the same facilitator identity and a device
 * provisioned for one verifies receipts from the other.
 *
 * docs/PROTOCOL.md is explicit that this concentrates trust here: a dishonest
 * facilitator could mint a receipt for a payment that never settled. The sensor
 * still independently enforces nonce freshness, single use, recipient, amount and
 * expiry, so a compromised facilitator can fabricate a payment but cannot replay,
 * redirect, or discount one.
 *
 * One non-obvious rule, enforced below: a transaction signature may mint at most
 * one receipt, ever. Memo binding already ties a payment to a challenge; this
 * closes the door from the other side.
 */

/** Accepts both this spine's field names and the simulator relay's. */
interface SettleBody {
  signature?: string;
  txSignature?: string;
  nonce?: string;
  payTo?: string;
  amountMicroUsdc?: string;
  amount?: string;
  network?: string;
}

export interface FacilitatorDeps {
  config: Config;
  connection: Connection | null;
}

export function createFacilitatorServer(deps: FacilitatorDeps) {
  const { config, connection } = deps;
  const { publicKey } = getKeys();

  /** Signatures already turned into receipts. One transfer, one receipt. */
  const spentSignatures = new Set<string>();
  let issued = 0;
  let rejected = 0;

  const server = createServer((req, res) => {
    const path = pathOf(req);

    void (async () => {
      if (req.method === 'GET' && path === '/facilitator/pubkey') {
        // Hex, because this is the form that gets provisioned into a device.
        sendJson(res, 200, {
          publicKeyHex: Buffer.from(publicKey).toString('hex'),
          algorithm: 'ed25519',
        });
        return;
      }

      if (req.method === 'GET' && path === '/health') {
        let rpcReachable: boolean | null = null;
        let slot: number | null = null;
        if (connection) {
          try {
            slot = await connection.getSlot();
            rpcReachable = true;
          } catch {
            rpcReachable = false;
          }
        }
        sendJson(res, 200, {
          ok: config.settlement === 'mock' || rpcReachable === true,
          settlement: config.settlement,
          network: config.network,
          rpcReachable,
          slot,
          receiptsIssued: issued,
          receiptsRejected: rejected,
          // Stated plainly so nobody mistakes a mock run for a real one.
          warning:
            config.settlement === 'mock'
              ? 'MOCK SETTLEMENT: receipts are signed without any on-chain verification'
              : null,
        });
        return;
      }

      if (req.method === 'POST' && path === '/settle') {
        let body: SettleBody;
        try {
          body = await readJsonBody<SettleBody>(req);
        } catch (e) {
          rejected++;
          sendJson(res, 400, { error: 'bad_request', detail: (e as Error).message });
          return;
        }

        const signature = body.signature ?? body.txSignature;
        const amountMicroUsdc = body.amountMicroUsdc ?? body.amount;
        const { nonce, payTo } = body;

        if (!signature || !nonce || !payTo || !amountMicroUsdc) {
          rejected++;
          sendJson(res, 400, {
            error: 'bad_request',
            detail: 'need signature (or txSignature), nonce, payTo, amountMicroUsdc (or amount)',
          });
          return;
        }

        const network = body.network ?? config.network;
        if (network !== config.network) {
          rejected++;
          sendJson(res, 400, {
            error: 'wrong_network',
            detail: `facilitator serves ${config.network}`,
          });
          return;
        }

        if (spentSignatures.has(signature)) {
          rejected++;
          sendJson(res, 409, {
            error: 'signature_already_settled',
            detail: 'one transaction may mint at most one receipt',
          });
          return;
        }

        let verdict: SettlementResult;
        if (config.settlement === 'mock') {
          verdict = { ok: true, observedAmount: amountMicroUsdc, payer: null, slot: 0 };
        } else if (!connection) {
          rejected++;
          sendJson(res, 503, {
            error: 'no_rpc',
            detail: 'devnet settlement requires an RPC connection',
          });
          return;
        } else {
          verdict = await verifySettlement(connection, {
            signature,
            nonce,
            payTo,
            amountMicroUsdc,
            network: config.network,
          });
        }

        if (!verdict.ok) {
          rejected++;
          sendJson(res, 402, { error: verdict.reason, detail: verdict.detail });
          return;
        }

        // Verified. Hand off to the existing signer.
        const signed = settle({
          nonce,
          txSignature: signature,
          payTo,
          amount: verdict.observedAmount,
          network,
        });
        if (!signed.success) {
          rejected++;
          sendJson(res, 500, { error: 'sign_failed', detail: signed.errorReason });
          return;
        }

        spentSignatures.add(signature);
        issued++;

        sendJson(res, 200, {
          receipt: signed.receipt,
          settleHeader: signed.settleHeader,
          settledAmount: verdict.observedAmount,
          payer: verdict.payer,
          slot: verdict.slot,
          mode: config.settlement,
        });
        return;
      }

      sendJson(res, 404, { error: 'not_found', path });
    })().catch((e: unknown) => {
      rejected++;
      sendJson(res, 500, { error: 'internal', detail: (e as Error).message });
    });
  });

  return { server, stats: () => ({ issued, rejected, spent: spentSignatures.size }) };
}

function main(): void {
  const config = loadConfig();
  const connection =
    config.settlement === 'devnet' ? new Connection(config.rpcUrl, 'confirmed') : null;

  const { server } = createFacilitatorServer({ config, connection });
  const { publicKey } = getKeys();

  server.listen(config.facilitatorPort, () => {
    console.log(`[facilitator] :${config.facilitatorPort}  ${describeConfig(config)}`);
    console.log(`[facilitator] pubkey ${Buffer.from(publicKey).toString('hex')}`);
    if (config.settlement === 'mock') {
      console.log('[facilitator] MOCK SETTLEMENT — nothing is verified on-chain');
    }
  });
}

if (process.argv[1]?.endsWith('facilitator-server.js')) {
  main();
}
