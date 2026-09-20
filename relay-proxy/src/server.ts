import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair } from '@solana/web3.js';
import { buildDeviceChallenge, verifyDeviceReceipt, VENDOR_PRICE_USD } from './simulator.js';
import { readBadge, badgeAttached } from './badge-source.js';
import { captureScreen, screenEnabled } from './badge-screen.js';
import { settle, SETTLEMENT_MODE, type Attribution, type SettleRequest } from './facilitator.js';
import { createStoreFromEnv, StoreUnavailableError, type Store } from './store/index.js';
import { getRelayIdentity } from './identity.js';
import { AGENT_KEY_HEADER, WEB_AGENT_HEADER, WEB_SECRET_HEADER, WEB_USER_HEADER, resolveAgent, type AgentResolution } from './agent-auth.js';
import { deviceState, getHeartbeatState, startHeartbeat } from './heartbeat.js';
import { buildLedgerStatus } from './ledger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

export const DEFAULT_PORT = 3402;

/** Must match DAY_CAP_MICRO_USDC in agent-buyer/src/policy.ts. */
const DAY_CAP_MICRO_USDC = 5_000_000n;

/** Optional RPC — when unset, /api/ledger reports deployed:false without hitting the network (keeps unit tests offline). */
function ledgerConnection(): Connection | null {
  const rpc = process.env.VENDX_RPC_URL ?? process.env.VENDX_LEDGER_RPC;
  if (!rpc) return null;
  return new Connection(rpc, 'confirmed');
}

function ledgerAuthorityKeypair(): Keypair | null {
  const raw = process.env.VENDX_LEDGER_AUTHORITY;
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}

const ALLOW_HEADERS = ['Content-Type', 'X-Payment-Receipt', 'X-Payment', AGENT_KEY_HEADER, WEB_SECRET_HEADER, WEB_USER_HEADER, WEB_AGENT_HEADER].join(', ');

const solscanUrl = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'X-Payment-Response',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readSpendLedger(): { date: string; spentMicroUsdc: string } {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'spend-ledger.json'), 'utf8')) as {
      date: string;
      spentMicroUsdc: string;
    };
  } catch {
    return { date: new Date().toISOString().slice(0, 10), spentMicroUsdc: '0' };
  }
}

function attributionOf(r: AgentResolution): Attribution {
  switch (r.status) {
    case 'ok': return 'agent';
    case 'web': return 'web';
    case 'revoked': return 'revoked_key';
    case 'unknown':
    case 'malformed': return 'unknown_key';
    default: return 'anonymous';
  }
}

/** 401 body for a key that cannot be honoured, or null when the request may proceed. */
function keyRejection(r: AgentResolution): { error: string; hint: string } | null {
  if (r.status === 'malformed' || r.status === 'unknown') {
    return { error: 'bad_agent_key', hint: `${AGENT_KEY_HEADER} is not a key this relay knows; mint one on the website or omit the header` };
  }
  if (r.status === 'revoked') return { error: 'agent_revoked', hint: 'this API key was revoked on the website' };
  return null;
}

export interface RelayServerOptions {
  /** Defaults to createStoreFromEnv(): Supabase when configured, else memory. */
  store?: Store;
  /** Advertise this relay in the directory (default true). */
  heartbeat?: boolean;
}

export function createRelayServer(port = DEFAULT_PORT, opts: RelayServerOptions = {}) {
  const identity = getRelayIdentity(port);
  const store = opts.store ?? createStoreFromEnv(process.env, identity.relayId);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await handle(req, res);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof StoreUnavailableError) {
        console.error(`[relay-proxy] ${e.message}`);
        return json(res, 503, { error: 'store_unavailable', op: e.op });
      }
      console.error('[relay-proxy] unhandled error:', e);
      return json(res, 500, { error: 'internal' });
    }
  });

  server.on('listening', () => {
    if (opts.heartbeat !== false) startHeartbeat(store, { port });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const { pathname } = url;

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        'Access-Control-Max-Age': '600',
      });
      return void res.end();
    }

    // GET /api/screen — live badge screen, local demo only.
    // Gated behind VENDX_ALLOW_SCREEN because the badge home screen renders
    // the attendee's name, badge ID and identity QR. See docs/BADGE.md.
    if (req.method === 'GET' && pathname === '/api/screen') {
      if (!screenEnabled()) {
        return json(res, 404, {
          error: 'screen_capture_disabled',
          hint: 'set VENDX_ALLOW_SCREEN=1 to enable; it exposes personal data on the badge screen',
        });
      }
      const pngBuf = await captureScreen();
      if (!pngBuf) return json(res, 503, { error: 'capture_failed', badgeAttached: badgeAttached() });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return void res.end(pngBuf);
    }

    // GET /api/telemetry — paywalled device telemetry endpoint
    if (req.method === 'GET' && pathname === '/api/telemetry') {
      const receiptHeader = req.headers['x-payment-receipt'];

      if (!receiptHeader || typeof receiptHeader !== 'string') {
        // A key that cannot be honoured is rejected here, before any money moves.
        const who = await resolveAgent(req, store);
        const rejection = keyRejection(who);
        if (rejection) return json(res, 401, rejection);
        const telemetry = await readBadge();
        const challenge = await buildDeviceChallenge(store, telemetry.deviceId);
        return json(res, 402, challenge);
      }

      const result = await verifyDeviceReceipt(receiptHeader, store);
      if (!result.ok) {
        return json(res, 402, { error: result.reason });
      }

      return json(res, 200, await readBadge());
    }

    // POST /settle — facilitator endpoint
    if (req.method === 'POST' && pathname === '/settle') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: 'bad_json' });
      }

      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as Record<string, unknown>).nonce !== 'string' ||
        typeof (parsed as Record<string, unknown>).txSignature !== 'string'
      ) {
        return json(res, 400, { error: 'missing_fields: need nonce, txSignature' });
      }

      const req2 = parsed as Record<string, unknown>;
      const settleReq: SettleRequest = {
        nonce: req2.nonce as string,
        txSignature: req2.txSignature as string,
        payTo: (req2.payTo as string | undefined) ?? '',
        amount: (req2.amount as string | undefined) ?? '0',
        network: (req2.network as string | undefined) ?? 'solana-devnet',
      };

      // The buyer has already paid: a bad key never fails a settle, it only
      // changes who the sale is credited to.
      const who = await resolveAgent(req, store);
      const telemetry = await readBadge();
      const result = await settle(settleReq, {
        store,
        sale: {
          relayId: identity.relayId,
          source: telemetry.source,
          deviceId: telemetry.deviceId,
          agent: who.status === 'ok' ? who.agent : null,
          userId: who.status === 'web' ? who.userId : null,
          // The website buying for one of its user's agents (an MCP connection).
          agentId: who.status === 'web' ? who.agentId ?? null : null,
        },
        attribution: attributionOf(who),
      });
      if (!result.success) {
        return json(res, 402, result);
      }

      res.setHeader('X-Payment-Response', result.settleHeader);
      return json(res, 200, {
        receipt: result.receipt,
        success: true,
        attribution: result.attribution,
        ...(result.idempotent ? { idempotent: true } : {}),
      });
    }

    // GET /api/devices — fleet list
    if (req.method === 'GET' && pathname === '/api/devices') {
      const telemetry = await readBadge();
      const deviceSales = await store.listSales({ source: telemetry.source, limit: 1000 });
      const totalEarned = deviceSales.reduce(
        (sum, s) => sum + BigInt(s.amountMicroUsdc),
        0n,
      );
      return json(res, 200, {
        devices: [
          {
            id: telemetry.deviceId,
            source: telemetry.source,
            priceUsd: VENDOR_PRICE_USD,
            freeHeap: telemetry.freeHeap ?? null,
            largestBlock: telemetry.largestBlock ?? null,
            chip: telemetry.chip ?? null,
            lastSeen: telemetry.timestamp,
            totalSales: deviceSales.length,
            totalEarnedMicroUsdc: totalEarned.toString(),
          },
        ],
      });
    }

    // GET /api/devices/:id — single device detail
    const deviceMatch = /^\/api\/devices\/([^/]+)$/.exec(pathname);
    if (req.method === 'GET' && deviceMatch) {
      const id = decodeURIComponent(deviceMatch[1]);
      const telemetry = await readBadge();
      if (telemetry.deviceId !== id) {
        return json(res, 404, { error: 'device_not_found', id });
      }
      const deviceSales = await store.listSales({ limit: 50 });
      return json(res, 200, { device: telemetry, recentSales: deviceSales });
    }

    // GET /api/sales — this relay's sales, newest first (receipts never included)
    if (req.method === 'GET' && pathname === '/api/sales') {
      return json(res, 200, { sales: await store.listSales({ limit: 200 }) });
    }

    // GET /api/directory — every relay and device that has heartbeated into the store
    if (req.method === 'GET' && pathname === '/api/directory') {
      const { relays, devices } = await store.listDirectory();
      const now = Math.floor(Date.now() / 1000);
      return json(res, 200, {
        persistence: store.kind,
        relays: relays.map((r) => ({ ...r, state: deviceState(r.lastSeen, now), ageSeconds: now - r.lastSeen })),
        devices: devices.map((d) => ({ ...d, state: deviceState(d.lastSeen, now), ageSeconds: now - d.lastSeen })),
      });
    }

    // GET /api/me — the agent behind an API key
    if (req.method === 'GET' && (pathname === '/api/me' || pathname === '/api/me/purchases')) {
      const who = await resolveAgent(req, store);
      if (who.status === 'anonymous' || who.status === 'web') {
        return json(res, 401, { error: 'missing_agent_key', hint: `send ${AGENT_KEY_HEADER}: vendx_sk_…` });
      }
      const rejection = keyRejection(who);
      if (rejection || who.status !== 'ok') return json(res, 401, rejection ?? { error: 'bad_agent_key' });
      const { agent } = who;
      if (pathname === '/api/me') {
        return json(res, 200, {
          agent: { id: agent.id, name: agent.name, keyPrefix: agent.keyPrefix, createdAt: agent.createdAt, lastUsedAt: agent.lastUsedAt },
          userId: agent.userId,
          persistence: store.kind,
        });
      }
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
      const purchases = await store.listSalesForAgent(agent.id, limit);
      return json(res, 200, {
        agent: { id: agent.id, name: agent.name },
        purchases: purchases.map((s) => ({ ...s, solscanUrl: solscanUrl(s.txSignature) })),
      });
    }

    // GET /api/policy — APEX spend policy state.
    //
    // The top-level numbers are the buyer AGENT's budget: agent-buyer writes
    // data/spend-ledger.json when it pays, and nothing else does. A person
    // paying through the site with Phantom is a different payer, so their
    // spend is answered separately: ?payer=<wallet> adds a `payer` block
    // computed from this relay's settled sales for that wallet today (the
    // newest 1000 in the store), and in trust mode every payer is 'unverified'
    // (the chain was never read).
    if (req.method === 'GET' && pathname === '/api/policy') {
      const ledger = readSpendLedger();
      const spent = BigInt(ledger.spentMicroUsdc);
      const remaining = spent >= DAY_CAP_MICRO_USDC ? 0n : DAY_CAP_MICRO_USDC - spent;
      const today = new Date().toISOString().slice(0, 10);
      const payerWallet = url.searchParams.get('payer');
      let payer: Record<string, unknown> | undefined;
      if (payerWallet) {
        const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
        const mine = (await store.listSales({ limit: 1000 })).filter((s) => s.payer === payerWallet && utcDay(s.timestamp) === today);
        const payerSpent = mine.reduce((sum, s) => sum + BigInt(s.amountMicroUsdc), 0n);
        const payerRemaining = payerSpent >= DAY_CAP_MICRO_USDC ? 0n : DAY_CAP_MICRO_USDC - payerSpent;
        payer = {
          wallet: payerWallet,
          spentMicroUsdc: payerSpent.toString(),
          remainingMicroUsdc: payerRemaining.toString(),
          sales: mine.length,
          lastSaleAt: mine[0]?.timestamp ?? null,
          date: today,
          sinceRelayStart: true,
        };
      }
      return json(res, 200, {
        capMicroUsdc: DAY_CAP_MICRO_USDC.toString(),
        spentMicroUsdc: spent.toString(),
        remainingMicroUsdc: remaining.toString(),
        date: ledger.date,
        capUsd: 5.0,
        spentUsd: Number(spent) / 1_000_000,
        remainingUsd: Number(remaining) / 1_000_000,
        perRequestLimitMicroUsdc: '100',
        perVendorLimitMicroUsdc: '1000000',
        payersVerified: SETTLEMENT_MODE === 'verify',
        ...(payer ? { payer } : {}),
      });
    }

    // GET /api/ledger — on-chain ledger status (deployed flag is live when VENDX_RPC_URL is set)
    if (req.method === 'GET' && pathname === '/api/ledger') {
      const allSales = await store.listSales({ limit: 1000 });
      const totalSettled = allSales.reduce(
        (sum, s) => sum + BigInt(s.amountMicroUsdc),
        0n,
      );
      const authority = ledgerAuthorityKeypair();
      const status = await buildLedgerStatus(
        ledgerConnection(),
        authority?.publicKey ?? null,
        'solana-devnet',
        allSales.length,
      );
      return json(res, 200, {
        programId: status.programId,
        network: status.network,
        deployed: status.deployed,
        initialized: status.initialized,
        authority: status.authority,
        onChain: status.onChain
          ? {
              totalBuckets: status.onChain.totalBuckets.toString(),
              totalSettledMicroUsdc: status.onChain.totalSettledMicroUsdc.toString(),
              lastCommitSlot: status.onChain.lastCommitSlot.toString(),
              stateRootHex: Buffer.from(status.onChain.stateRoot).toString('hex'),
            }
          : null,
        lastCommitSignature: status.lastCommitSignature,
        totalBuckets: allSales.length,
        totalSettledMicroUsdc: totalSettled.toString(),
        totalSettledUsd: Number(totalSettled) / 1_000_000,
        entries: allSales.slice(0, 20).map((s) => ({
          nonce: s.nonce,
          amountMicroUsdc: s.amountMicroUsdc,
          timestamp: s.timestamp,
          txSignature: s.txSignature,
          source: s.source,
          solscanUrl: solscanUrl(s.txSignature),
        })),
        compressionNote:
          'Each batch of up to 64 buckets is committed as a single state-root update, ' +
          'versus 64 separate rent-paying accounts in naive storage.',
      });
    }

    // GET /health
    if (req.method === 'GET' && pathname === '/health') {
      const hb = getHeartbeatState();
      const degraded = store.kind === 'supabase' && hb.count > 0 && !hb.ok;
      return json(res, 200, {
        status: degraded ? 'degraded' : 'ok',
        mode: badgeAttached() ? 'badge' : 'simulator',
        persistence: store.kind,
        settlement: SETTLEMENT_MODE,
        relayId: identity.relayId,
        publicUrl: identity.publicUrl,
        heartbeat: hb,
      });
    }

    return json(res, 404, { error: 'not_found' });
  }

  return server;
}
