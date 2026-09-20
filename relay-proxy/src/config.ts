import { resolve } from 'node:path';
import type { VendxNetwork } from '@vendx/protocol';

/**
 * Configuration for the real-settlement spine.
 *
 * Ports are deliberately NOT 3402: the existing simulator relay
 * (relay-proxy/src/server.ts, `npm run demo`) owns that one, and both must be
 * able to run side by side so the simulator demo keeps working untouched.
 */

export type SettlementMode = 'devnet' | 'mock';

export interface Config {
  nodePort: number;
  facilitatorPort: number;
  /** Where the buyer reaches the facilitator. */
  facilitatorUrl: string;
  network: VendxNetwork;
  rpcUrl: string;
  settlement: SettlementMode;
  /** UDP port RuView firmware streams to. */
  csiPort: number;
  repoRoot: string;
  nodeId: number;
  resource: string;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

export function loadConfig(): Config {
  const network = str('VENDX_NETWORK', 'solana-devnet') as VendxNetwork;
  const settlement = str('VENDX_SETTLEMENT', 'mock') as SettlementMode;
  if (settlement !== 'devnet' && settlement !== 'mock') {
    throw new Error(`VENDX_SETTLEMENT must be "devnet" or "mock", got "${settlement}"`);
  }

  const facilitatorPort = num('VENDX_FACILITATOR_PORT', 4022);
  return {
    nodePort: num('VENDX_NODE_PORT', 4021),
    facilitatorPort,
    facilitatorUrl: str('VENDX_FACILITATOR_URL', `http://127.0.0.1:${facilitatorPort}`),
    network,
    rpcUrl: str(
      'VENDX_RPC_URL',
      network === 'solana'
        ? 'https://api.mainnet-beta.solana.com'
        : 'https://api.devnet.solana.com',
    ),
    settlement,
    csiPort: num('VENDX_CSI_PORT', 5005),
    repoRoot: resolve(str('VENDX_ROOT', process.cwd())),
    nodeId: num('VENDX_NODE_ID', 1),
    resource: str('VENDX_RESOURCE', '/api/telemetry'),
  };
}

/** One-line banner so every process states its own mode on startup. */
export function describeConfig(c: Config): string {
  return `network=${c.network} settlement=${c.settlement} rpc=${new URL(c.rpcUrl).host}`;
}
