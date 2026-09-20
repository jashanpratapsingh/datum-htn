#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair } from '@solana/web3.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadOrCreateWallet, walletPath, type VendxNetwork } from '@vendx/protocol';
import { Buyer, type BuyerConfig } from '@vendx/agent-buyer/dist/buy.js';
import { allowanceStatus, type AllowanceContext } from '@vendx/agent-buyer/dist/allowance.js';

/**
 * VENDX MCP server.
 *
 * Lets any MCP-speaking agent (Claude Code, Claude Desktop, a buyer bot on
 * someone else's stack) browse VENDX's listed sensors and pay one of them for
 * a reading, using the exact same 402 -> policy -> pay -> receipt -> 200 arc
 * `agent-buyer` already runs from the CLI. This file is a thin MCP skin over
 * that arc, not a second implementation of it:
 *
 *   - listing/read tools hit relay-proxy's REST API (docs/API.md) directly;
 *   - `vendx_buy_telemetry` constructs the same `Buyer` class `buy.ts` uses,
 *     so the daily SpendPolicy cap and the on-chain delegate allowance both
 *     still apply — an agent cannot use this server to spend past either.
 *
 * Nothing here grants or revokes the on-chain allowance (`npm run allowance`
 * stays a manual, human-run step) — an MCP tool that changes spending
 * authority is a materially different risk than one that spends within an
 * authority a human already granted.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** packages/vendx-mcp/dist -> packages/vendx-mcp -> packages -> repo root. */
const DEFAULT_REPO_ROOT = resolve(__dirname, '../../..');

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const DEFAULTS = {
  relayUrl: env('VENDX_RELAY_URL', 'http://127.0.0.1:3402'),
  nodeUrl: env('VENDX_NODE_URL', 'http://127.0.0.1:4021'),
  facilitatorUrl: env('VENDX_FACILITATOR_URL', 'http://127.0.0.1:4022'),
  network: env('VENDX_NETWORK', 'solana-devnet') as VendxNetwork,
  rpcUrl: env('VENDX_RPC_URL', 'https://api.devnet.solana.com'),
  settlement: env('VENDX_SETTLEMENT', 'mock') as 'devnet' | 'mock',
  resource: env('VENDX_RESOURCE', '/api/telemetry'),
  repoRoot: env('VENDX_ROOT', DEFAULT_REPO_ROOT),
};

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  const body: unknown = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function textResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * `Buyer` (and the modules it calls) log a human-readable trace via
 * `console.log`. On stdio transport, stdout is the JSON-RPC channel — a
 * stray log line there corrupts the protocol framing. Route it to stderr for
 * the duration of the call instead of silencing it, so the trace still shows
 * up wherever the host prints MCP server stderr.
 */
async function withStdoutLoggingSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

const server = new McpServer({ name: 'vendx', version: '0.1.0' });

server.registerTool(
  'vendx_list_devices',
  {
    title: 'List VENDX devices',
    description:
      'List the sensors currently vending data through a VENDX relay: device id, ' +
      'price, live/simulated status and lifetime sales. Use this to discover what ' +
      'data is for sale before buying it.',
    inputSchema: {
      relayUrl: z
        .string()
        .url()
        .optional()
        .describe(`Relay base URL. Defaults to ${DEFAULTS.relayUrl}.`),
    },
  },
  async ({ relayUrl }) => {
    const base = relayUrl ?? DEFAULTS.relayUrl;
    const { status, body } = await getJson(`${base}/api/devices`);
    return textResult({ status, ...(body as object) });
  },
);

server.registerTool(
  'vendx_get_device',
  {
    title: 'Get one VENDX device',
    description:
      'Get detail on a single VENDX device by id (from vendx_list_devices), ' +
      'including its recent sale history.',
    inputSchema: {
      deviceId: z.string().describe('Device id, e.g. "esp32-sim-001" or "htn-badge-<hash>".'),
      relayUrl: z
        .string()
        .url()
        .optional()
        .describe(`Relay base URL. Defaults to ${DEFAULTS.relayUrl}.`),
    },
  },
  async ({ deviceId, relayUrl }) => {
    const base = relayUrl ?? DEFAULTS.relayUrl;
    const { status, body } = await getJson(`${base}/api/devices/${encodeURIComponent(deviceId)}`);
    return textResult({ status, ...(body as object) });
  },
);

server.registerTool(
  'vendx_get_sales',
  {
    title: 'List VENDX settlement records',
    description: 'List every settled sale a VENDX relay has recorded since it started.',
    inputSchema: {
      relayUrl: z
        .string()
        .url()
        .optional()
        .describe(`Relay base URL. Defaults to ${DEFAULTS.relayUrl}.`),
    },
  },
  async ({ relayUrl }) => {
    const base = relayUrl ?? DEFAULTS.relayUrl;
    const { status, body } = await getJson(`${base}/api/sales`);
    return textResult({ status, ...(body as object) });
  },
);

server.registerTool(
  'vendx_get_ledger',
  {
    title: 'Get the VENDX on-chain ledger summary',
    description:
      'Summarize the ZK-compressed on-chain settlement ledger for a VENDX relay: ' +
      'total settled, whether the Anchor program is deployed, and recent entries ' +
      'with Solscan links.',
    inputSchema: {
      relayUrl: z
        .string()
        .url()
        .optional()
        .describe(`Relay base URL. Defaults to ${DEFAULTS.relayUrl}.`),
    },
  },
  async ({ relayUrl }) => {
    const base = relayUrl ?? DEFAULTS.relayUrl;
    const { status, body } = await getJson(`${base}/api/ledger`);
    return textResult({ status, ...(body as object) });
  },
);

server.registerTool(
  'vendx_check_budget',
  {
    title: "Check the buying agent's daily spend cap",
    description:
      "Read the buyer's soft daily USDC spend cap and how much of it is already " +
      'spent. Check this before calling vendx_buy_telemetry to avoid a denied purchase.',
    inputSchema: {
      relayUrl: z
        .string()
        .url()
        .optional()
        .describe(`Relay base URL. Defaults to ${DEFAULTS.relayUrl}.`),
    },
  },
  async ({ relayUrl }) => {
    const base = relayUrl ?? DEFAULTS.relayUrl;
    const { status, body } = await getJson(`${base}/api/policy`);
    return textResult({ status, ...(body as object) });
  },
);

server.registerTool(
  'vendx_check_allowance',
  {
    title: "Check the buying agent's on-chain spend authority",
    description:
      'Read the HARD spend limit straight off Solana: the SPL Token delegate ' +
      "authority the treasury granted the agent's hot key, and how much of it " +
      'remains. This is the authoritative limit — the daily cap in ' +
      'vendx_check_budget is enforced by this server, this one is enforced by the ' +
      'token program itself. Read-only; does not grant or revoke anything ' +
      '(that stays a manual "npm run allowance" step for a human).',
    inputSchema: {
      network: z
        .enum(['solana', 'solana-devnet'])
        .optional()
        .describe(`Defaults to ${DEFAULTS.network}.`),
      rpcUrl: z.string().url().optional().describe(`Defaults to ${DEFAULTS.rpcUrl}.`),
      repoRoot: z
        .string()
        .optional()
        .describe('Repo root that owns keys/treasury.json and keys/agent.json.'),
    },
  },
  async ({ network, rpcUrl, repoRoot }) => {
    const net = (network ?? DEFAULTS.network) as VendxNetwork;
    const root = repoRoot ?? DEFAULTS.repoRoot;
    const connection = new Connection(rpcUrl ?? DEFAULTS.rpcUrl, 'confirmed');
    const treasury = Keypair.fromSecretKey(loadOrCreateWallet(walletPath('treasury', root)).secretKey);
    const agent = Keypair.fromSecretKey(loadOrCreateWallet(walletPath('agent', root)).secretKey);
    const ctx: AllowanceContext = { connection, network: net, treasury, agent: agent.publicKey };
    try {
      const status = await allowanceStatus(ctx);
      return textResult({
        treasury: treasury.publicKey.toBase58(),
        agent: agent.publicKey.toBase58(),
        network: net,
        ...status,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message || e.name : String(e);
      return textResult({
        error: message,
        hint: 'Usually means no RPC route to rpcUrl, or the treasury ATA has never been created.',
      });
    }
  },
);

server.registerTool(
  'vendx_buy_telemetry',
  {
    title: 'Buy one VENDX telemetry reading',
    description:
      'Run the full x402 purchase arc against a VENDX node: GET the resource, ' +
      'receive a 402 challenge, check the daily spend policy, pay USDC on Solana ' +
      "as the agent's delegate (or a mock signature when settlement is \"mock\"), " +
      'have the facilitator sign a receipt, and re-request with the receipt to ' +
      'receive the data. Defaults target the real-settlement node/facilitator pair ' +
      `(${DEFAULTS.nodeUrl} / ${DEFAULTS.facilitatorUrl}) that "npm run demo:solana" ` +
      'starts; pass nodeUrl/facilitatorUrl to buy from a different VENDX party. ' +
      'Spending is bounded by the same daily cap and on-chain allowance the CLI ' +
      'buyer enforces — this tool cannot spend past either.',
    inputSchema: {
      nodeUrl: z
        .string()
        .url()
        .optional()
        .describe(`Vendor node base URL. Defaults to ${DEFAULTS.nodeUrl}.`),
      facilitatorUrl: z
        .string()
        .url()
        .optional()
        .describe(`Facilitator base URL. Defaults to ${DEFAULTS.facilitatorUrl}.`),
      resource: z
        .string()
        .optional()
        .describe(`Paywalled path to request. Defaults to "${DEFAULTS.resource}".`),
      network: z
        .enum(['solana', 'solana-devnet'])
        .optional()
        .describe(`Defaults to ${DEFAULTS.network}.`),
      rpcUrl: z.string().url().optional().describe(`Defaults to ${DEFAULTS.rpcUrl}.`),
      settlement: z
        .enum(['mock', 'devnet'])
        .optional()
        .describe(
          `"mock" fabricates a recognisable placeholder signature (no funds move); ` +
            `"devnet" sends a real devnet USDC transfer. Defaults to "${DEFAULTS.settlement}".`,
        ),
      repoRoot: z
        .string()
        .optional()
        .describe('Repo root that owns keys/treasury.json, keys/agent.json and data/spend-ledger.json.'),
    },
  },
  async ({ nodeUrl, facilitatorUrl, resource, network, rpcUrl, settlement, repoRoot }) => {
    const config: BuyerConfig = {
      nodeUrl: nodeUrl ?? DEFAULTS.nodeUrl,
      facilitatorUrl: facilitatorUrl ?? DEFAULTS.facilitatorUrl,
      network: (network ?? DEFAULTS.network) as VendxNetwork,
      rpcUrl: rpcUrl ?? DEFAULTS.rpcUrl,
      settlement: settlement ?? DEFAULTS.settlement,
      repoRoot: repoRoot ?? DEFAULTS.repoRoot,
      resource: resource ?? DEFAULTS.resource,
    };
    const buyer = new Buyer(config);
    const outcome = await withStdoutLoggingSuppressed(() => buyer.buyOnce());
    return textResult(outcome);
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e: unknown) => {
  console.error('[vendx-mcp] fatal:', e);
  process.exit(1);
});
