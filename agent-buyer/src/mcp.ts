#!/usr/bin/env node
/**
 * VENDX MCP server: lets a Claude Code agent browse the marketplace and buy
 * device telemetry with real devnet USDC.
 *
 *   claude mcp add -s user -e VENDX_API_KEY=vendx_sk_… -e RELAY_URL=https://relay.vendx.biz \
 *     vendx -- node /abs/path/vendx-htn/agent-buyer/dist/mcp.js
 *
 * Env: RELAY_URL (default https://relay.vendx.biz), VENDX_API_KEY (optional;
 * ties purchases to your account on the website), VENDX_BUYER_KEYPAIR
 * (optional; see wallet.ts for the default), VENDX_SOLANA_RPC (optional).
 *
 * stdout is the MCP transport; every log line goes to stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { microUsdcToUsd } from '@vendx/protocol';
import { AGENT_KEY_HEADER, BuyError, buyReading } from './buy.js';
import { BUYER_KEYPAIR_PATH, buyerSolBalance, buyerUsdcBalance, ensureBuyerKeypair, fundingHints } from './wallet.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const DEFAULT_RELAY = (process.env.RELAY_URL ?? 'https://relay.vendx.biz').replace(/\/+$/, '');
const API_KEY = process.env.VENDX_API_KEY;
const log = (l: string) => console.error(l);

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] });
const fail = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }], isError: true });
const pretty = (v: unknown) => JSON.stringify(v, null, 2);

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  const body: unknown = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const server = new McpServer({ name: 'vendx', version: VERSION });

server.registerTool(
  'vendx_list_devices',
  {
    title: 'List VENDX devices',
    description:
      'List the sensors for sale on the VENDX marketplace: every relay that has advertised itself and the devices it sells ' +
      '(price in micro-USDC, source badge|simulator|esp32c3, liveness). Reads the relay directory; falls back to the single-relay device list.',
    inputSchema: { relayUrl: z.string().url().optional().describe('Relay base URL; defaults to RELAY_URL') },
  },
  async ({ relayUrl }) => {
    const base = (relayUrl ?? DEFAULT_RELAY).replace(/\/+$/, '');
    try {
      const dir = await getJson(`${base}/api/directory`);
      if (dir.status === 200) return text(pretty({ relay: base, ...(dir.body as object) }));
      const devices = await getJson(`${base}/api/devices`);
      if (devices.status === 200) return text(pretty({ relay: base, ...(devices.body as object), note: 'relay has no directory endpoint; single-relay listing' }));
      return fail(`relay ${base} answered ${dir.status}/${devices.status}`);
    } catch (e) {
      return fail(`relay ${base} unreachable: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  'vendx_buy_reading',
  {
    title: 'Buy a telemetry reading',
    description:
      'Buy one telemetry reading from a VENDX device with REAL devnet USDC from the local buyer wallet: fetch the 402 challenge, ' +
      'check the spend policy, transfer USDC on Solana devnet with the nonce as memo, settle at the relay for a signed receipt, ' +
      'and redeem it. Returns the telemetry (with its source), the transaction signature and a Solscan link. Costs the device price (typically 100 µUSDC).',
    inputSchema: {
      relayUrl: z.string().url().optional().describe('Relay base URL; defaults to RELAY_URL'),
      maxMicroUsdc: z.string().regex(/^\d+$/).optional().describe('Refuse offers above this many micro-USDC'),
    },
  },
  async ({ relayUrl, maxMicroUsdc }) => {
    try {
      const result = await buyReading({
        relayUrl: relayUrl ?? DEFAULT_RELAY,
        apiKey: API_KEY,
        maxMicroUsdc: maxMicroUsdc ? BigInt(maxMicroUsdc) : undefined,
        log,
      });
      return text(
        pretty({
          telemetry: result.telemetry,
          paid: { amountMicroUsdc: result.amountMicroUsdc, usd: microUsdcToUsd(result.amountMicroUsdc), payTo: result.payTo, network: result.network, payment: result.payment },
          txSignature: result.txSignature,
          solscanUrl: result.solscanUrl,
          attribution: result.attribution ?? 'anonymous',
          wallet: result.wallet,
        }),
      );
    } catch (e) {
      if (e instanceof BuyError) {
        const extra = e.code === 'buyer_unfunded' ? `\n\n${fundingHints()}` : e.detail ? `\n${typeof e.detail === 'string' ? e.detail : pretty(e.detail)}` : '';
        return fail(`${e.code}: ${e.message}${extra}`);
      }
      return fail(`purchase failed: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  'vendx_my_purchases',
  {
    title: 'My purchases',
    description: 'List the readings this agent has bought (requires VENDX_API_KEY, minted on the VENDX website under Account → Agents).',
    inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Newest N purchases, default 50') },
  },
  async ({ limit }) => {
    if (!API_KEY) return fail('VENDX_API_KEY is not set. Register an agent on the website (Account → Agents) and restart the MCP server with the key.');
    try {
      const r = await getJson(`${DEFAULT_RELAY}/api/me/purchases?limit=${limit ?? 50}`, { [AGENT_KEY_HEADER]: API_KEY });
      if (r.status !== 200) return fail(`relay answered ${r.status}: ${pretty(r.body)}`);
      return text(pretty(r.body));
    } catch (e) {
      return fail(`relay ${DEFAULT_RELAY} unreachable: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  'vendx_wallet',
  {
    title: 'Buyer wallet',
    description:
      'Show the local buyer wallet used for purchases: address, devnet SOL and USDC balances, and how to fund it. Creates the keypair if none exists yet.',
    inputSchema: {},
  },
  async () => {
    try {
      const kp = ensureBuyerKeypair();
      const [sol, usdc] = await Promise.all([buyerSolBalance('solana-devnet'), buyerUsdcBalance('solana-devnet')]);
      const out = {
        address: kp.publicKey,
        keypairPath: kp.path,
        created: kp.created,
        network: 'solana-devnet',
        solBalance: Number(sol) / 1e9,
        usdcBalance: usdc === null ? null : microUsdcToUsd(usdc.toString()),
        apiKey: API_KEY ? `${API_KEY.slice(0, 17)}… (purchases attributed to your account)` : 'not set (purchases are anonymous)',
        relay: DEFAULT_RELAY,
      };
      const needsFunds = sol < 5_000_000n || usdc === null || usdc === 0n;
      return text(pretty(out) + (needsFunds ? `\n\n${fundingHints(kp.publicKey)}` : ''));
    } catch (e) {
      return fail(`wallet error: ${(e as Error).message} (keypair path ${BUYER_KEYPAIR_PATH})`);
    }
  },
);

await server.connect(new StdioServerTransport());
log(`[vendx-mcp] ready — relay ${DEFAULT_RELAY}, key ${API_KEY ? 'set' : 'not set'}`);
