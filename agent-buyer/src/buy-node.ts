import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  loadOrCreateWallet,
  selectRequirements,
  usdcMintFor,
  walletPath,
  type PaymentRequiredBody,
  type VendxNetwork,
} from '@vendx/protocol';

import { SpendPolicy } from './policy.js';
import { allowanceStatus, type AllowanceContext } from './allowance.js';
import { mockPayment, payForChallenge, type PayResult } from './pay.js';

/**
 * The AI scraper, against a node that wants real money.
 *
 * `index.ts` already walks the 402 → pay → receipt → 200 arc against the
 * simulator. This is the same arc with the placeholder removed, and with two
 * budget layers instead of one:
 *
 *   SpendPolicy (policy.ts)   SOFT. A persisted daily cap. Catches mistakes
 *                             early, gives a readable reason, and avoids burning
 *                             a transaction fee on a doomed transfer.
 *   delegate (allowance.ts)   HARD. Enforced by the SPL Token program. Survives a
 *                             compromised or patched agent process.
 *
 * A soft limit alone is security theatre. A hard limit alone gives terrible
 * diagnostics — the agent learns only that the runtime said no. Having both is
 * the actual answer, and the pitch should say so out loud: "our budget is
 * enforced by the chain; this layer just makes the refusal legible."
 */

export interface BuyerConfig {
  nodeUrl: string;
  facilitatorUrl: string;
  network: VendxNetwork;
  rpcUrl: string;
  settlement: 'devnet' | 'mock';
  repoRoot: string;
  resource: string;
  /** Override the persisted daily ledger path. */
  ledgerFile?: string;
}

export interface PurchaseOutcome {
  ok: boolean;
  /** Why it stopped, when it did not succeed. */
  stoppedBecause?: string;
  priceMicroUsdc?: string;
  nonce?: string;
  txSignature?: string;
  receipt?: string;
  data?: unknown;
}

function log(tag: string, msg: string): void {
  console.log(`[${tag}] ${msg}`);
}

function fmt(micro: string | bigint): string {
  return `$${(Number(micro) / 1e6).toFixed(6)}`;
}

export class Buyer {
  private readonly policy: SpendPolicy;
  private readonly connection: Connection | null;
  private readonly treasury: Keypair;
  private readonly agent: Keypair;

  constructor(private readonly config: BuyerConfig) {
    this.policy = new SpendPolicy(config.ledgerFile);
    this.connection =
      config.settlement === 'devnet' ? new Connection(config.rpcUrl, 'confirmed') : null;

    const t = loadOrCreateWallet(walletPath('treasury', config.repoRoot));
    const a = loadOrCreateWallet(walletPath('agent', config.repoRoot));
    this.treasury = Keypair.fromSecretKey(t.secretKey);
    this.agent = Keypair.fromSecretKey(a.secretKey);
  }

  get treasuryPubkey(): PublicKey {
    return this.treasury.publicKey;
  }

  get agentPubkey(): PublicKey {
    return this.agent.publicKey;
  }

  private allowanceCtx(): AllowanceContext | null {
    if (!this.connection) return null;
    return {
      connection: this.connection,
      network: this.config.network,
      treasury: this.treasury,
      agent: this.agent.publicKey,
    };
  }

  /** Report the on-chain allowance, which is the authoritative limit. */
  async reportAllowance(): Promise<void> {
    const ctx = this.allowanceCtx();
    if (!ctx) {
      log('chain', 'mock settlement — no on-chain allowance to read');
      return;
    }
    try {
      const s = await allowanceStatus(ctx);
      log(
        'chain',
        `on-chain allowance: delegate=${s.delegate ?? 'none'} remaining ${s.remainingUsd.toFixed(6)} USDC (treasury balance ${s.balanceUsd.toFixed(6)})`,
      );
    } catch (e) {
      log('chain', `could not read allowance: ${(e as Error).message}`);
    }
  }

  /** One complete purchase. */
  async buyOnce(): Promise<PurchaseOutcome> {
    const url = `${this.config.nodeUrl}${this.config.resource}`;

    // --- 1. ask, expect to be refused --------------------------------
    log('buyer', `GET ${this.config.resource}`);
    const first = await fetch(url);

    if (first.status === 200) {
      const data: unknown = await first.json();
      log('buyer', 'served without payment — the node is not charging');
      return { ok: true, data };
    }
    if (first.status === 503) {
      const body = (await first.json()) as { error?: string; detail?: string };
      log('node', `${body.error}: ${body.detail}`);
      return { ok: false, stoppedBecause: body.detail ?? 'node unavailable' };
    }
    if (first.status !== 402) {
      return { ok: false, stoppedBecause: `unexpected status ${first.status}` };
    }

    const challenge = (await first.json()) as PaymentRequiredBody & {
      vendx?: { priceMicroUsdc?: string; pricing?: string; settleWith?: string };
    };

    const requirements = selectRequirements(challenge, {
      network: this.config.network,
      asset: usdcMintFor(this.config.network),
      maxMicroUsdc: this.policy.remainingToday,
    });
    if (!requirements) {
      return {
        ok: false,
        stoppedBecause: `no acceptable payment option (need ${this.config.network} USDC within ${fmt(this.policy.remainingToday)})`,
      };
    }

    const price = requirements.maxAmountRequired;
    const nonce = challenge.nonce;
    log('node', `402  nonce ${nonce.slice(0, 10)}...  ${fmt(price)}`);
    if (challenge.vendx?.pricing) log('node', `pricing: ${challenge.vendx.pricing}`);

    // --- 2. consult the soft daily cap -------------------------------
    const amount = BigInt(price);
    if (!this.policy.canSpend(amount)) {
      log(
        'policy',
        `DENIED — ${fmt(price)} would exceed the daily cap (${fmt(this.policy.spentToday)} already spent, ${fmt(this.policy.remainingToday)} left)`,
      );
      return { ok: false, stoppedBecause: 'daily spend cap', priceMicroUsdc: price, nonce };
    }
    log(
      'policy',
      `APPROVED — ${fmt(price)}, ${fmt(this.policy.remainingToday)} of today's budget left`,
    );

    // --- 3. pay, as delegate rather than as the treasury -------------
    let payment: PayResult;
    if (this.config.settlement === 'mock') {
      payment = mockPayment(nonce);
      log('chain', `mock payment ${payment.signature.slice(0, 16)}...`);
    } else {
      if (!this.connection) {
        return { ok: false, stoppedBecause: 'devnet settlement without an RPC connection' };
      }
      log('buyer', 'paying as delegate — the treasury key is not in this process');
      try {
        payment = await payForChallenge(
          {
            connection: this.connection,
            network: this.config.network,
            treasury: this.treasury.publicKey,
            agent: this.agent,
          },
          { payTo: requirements.payTo, amountMicroUsdc: price, nonce },
        );
      } catch (e) {
        // This is where an exhausted allowance lands: the token program refused.
        const detail = (e as Error).message;
        log('chain', `transfer REJECTED by the token program: ${firstLine(detail)}`);
        return {
          ok: false,
          stoppedBecause: 'on-chain allowance exhausted or transfer rejected',
          priceMicroUsdc: price,
          nonce,
        };
      }
      log('chain', `tx ${payment.signature.slice(0, 16)}... confirmed`);
      log('chain', explorerUrl(payment.signature, this.config.network));
    }

    // --- 4. have the facilitator bless it ----------------------------
    const settleUrl = challenge.vendx?.settleWith ?? `${this.config.facilitatorUrl}/settle`;
    const settleRes = await fetch(settleUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signature: payment.signature,
        nonce,
        payTo: requirements.payTo,
        amountMicroUsdc: price,
        network: this.config.network,
      }),
    });
    if (!settleRes.ok) {
      const body = (await settleRes.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      log('relay', `settle failed: ${body.error ?? settleRes.status} ${body.detail ?? ''}`);
      return { ok: false, stoppedBecause: `settle: ${body.error ?? settleRes.status}`, nonce };
    }
    const settled = (await settleRes.json()) as { receipt: string; mode?: string };
    log('relay', `receipt signed (${settled.mode ?? 'unknown'} settlement)`);

    // --- 5. ask again, with the receipt ------------------------------
    const second = await fetch(url, { headers: { 'x-payment-receipt': settled.receipt } });
    if (second.status !== 200) {
      const body = (await second.json().catch(() => ({}))) as { error?: string; detail?: string };
      log('node', `refused: ${body.error} — ${body.detail}`);
      return { ok: false, stoppedBecause: `node refused: ${body.error}`, nonce };
    }

    // Record the spend only once the data is actually in hand, matching the
    // ordering rationale in index.ts.
    this.policy.recordSpend(amount);

    const data: unknown = await second.json();
    log('node', 'ed25519 OK, nonce burned -> 200');
    log('buyer', `DATA ${JSON.stringify(data)}`);
    log('buyer', `cost ${fmt(price)}  spent today ${fmt(this.policy.spentToday)}`);

    return {
      ok: true,
      priceMicroUsdc: price,
      nonce,
      txSignature: payment.signature,
      receipt: settled.receipt,
      data,
    };
  }

  /** Prove a spent receipt cannot be reused. */
  async replay(receipt: string): Promise<string> {
    const res = await fetch(`${this.config.nodeUrl}${this.config.resource}`, {
      headers: { 'x-payment-receipt': receipt },
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return `${res.status} ${body.error ?? ''}`.trim();
  }
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? s;
}

function explorerUrl(sig: string, network: VendxNetwork): string {
  const cluster = network === 'solana' ? '' : '?cluster=devnet';
  return `https://explorer.solana.com/tx/${sig}${cluster}`;
}

async function main(): Promise<void> {
  const network = (process.env['VENDX_NETWORK'] ?? 'solana-devnet') as VendxNetwork;
  const settlement = (process.env['VENDX_SETTLEMENT'] ?? 'mock') as 'devnet' | 'mock';
  const facilitatorPort = process.env['VENDX_FACILITATOR_PORT'] ?? '4022';
  const nodePort = process.env['VENDX_NODE_PORT'] ?? '4021';

  const buyer = new Buyer({
    nodeUrl: process.env['VENDX_NODE_URL'] ?? `http://127.0.0.1:${nodePort}`,
    facilitatorUrl: process.env['VENDX_FACILITATOR_URL'] ?? `http://127.0.0.1:${facilitatorPort}`,
    network,
    rpcUrl: process.env['VENDX_RPC_URL'] ?? 'https://api.devnet.solana.com',
    settlement,
    repoRoot: process.env['VENDX_ROOT'] ?? process.cwd(),
    resource: process.env['VENDX_RESOURCE'] ?? '/api/telemetry',
  });

  log('chain', `treasury  ${buyer.treasuryPubkey.toBase58()}`);
  log('chain', `agent key ${buyer.agentPubkey.toBase58()}`);
  await buyer.reportAllowance();

  const rounds = Number(process.env['VENDX_ROUNDS'] ?? '1');
  let lastReceipt: string | null = null;

  for (let i = 0; i < rounds; i++) {
    if (rounds > 1) log('buyer', `--- round ${i + 1} of ${rounds} ---`);
    const outcome = await buyer.buyOnce();
    if (outcome.receipt) lastReceipt = outcome.receipt;
    if (!outcome.ok) {
      log('buyer', `stopped: ${outcome.stoppedBecause}`);
      break;
    }
  }

  if (lastReceipt && process.env['VENDX_DEMO_REPLAY'] === '1') {
    log('buyer', '--- replaying a spent receipt ---');
    log('node', await buyer.replay(lastReceipt));
  }
}

if (process.argv[1]?.endsWith('buy-node.js')) {
  void main();
}
