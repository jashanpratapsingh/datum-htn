import { badgeAttached, badgePort } from './badge-source.js';
import { hydrateNonces } from './nonce-store.js';
import { hydrateSales } from './sales-log.js';
import { createRelayServer, DEFAULT_PORT } from './server.js';
import { getKeys } from './keys.js';
import { supabaseEnabled } from './supabase.js';
import { startLedgerBatcher } from './ledger.js';
import { Connection, Keypair } from '@solana/web3.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = parseInt(process.env.RELAY_PORT ?? String(DEFAULT_PORT), 10);

// Ensure the facilitator keypair exists before accepting connections.
const keys = getKeys();
const pubHex = Buffer.from(keys.publicKey).toString('hex').slice(0, 16) + '…';
console.log(`[relay-proxy] facilitator pubkey: ${pubHex}`);

function loadLedgerAuthority(): Keypair | null {
  if (process.env.VENDX_LEDGER_AUTHORITY) {
    try {
      return Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(process.env.VENDX_LEDGER_AUTHORITY)),
      );
    } catch {
      return null;
    }
  }
  // Ledger authority = vendor wallet (receives USDC / owns the PDA seeds).
  const vendorPath = resolve(process.env.VENDX_ROOT ?? process.cwd(), 'keys/vendor.json');
  if (!existsSync(vendorPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(vendorPath, 'utf8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (supabaseEnabled()) {
    console.log('[relay-proxy] persistence: Supabase');
    await Promise.all([hydrateNonces(), hydrateSales()]);
  } else {
    console.log(
      '[relay-proxy] persistence: in-memory (set SUPABASE_URL + SUPABASE_SERVICE_KEY to survive restarts)',
    );
  }

  const rpc = process.env.VENDX_RPC_URL;
  const authority = loadLedgerAuthority();
  if (rpc && authority) {
    const conn = new Connection(rpc, 'confirmed');
    startLedgerBatcher(conn, authority).unref();
    console.log(`[relay-proxy] ledger batcher armed  authority=${authority.publicKey.toBase58()}`);
  }

  const server = createRelayServer(PORT);
  server.listen(PORT, () => {
    const serial = badgePort();
    const attached = badgeAttached();
    console.log(`[relay-proxy] listening on http://localhost:${PORT}`);
    console.log('[relay-proxy] routes: GET /api/telemetry  POST /settle  GET /health');
    console.log(
      `[relay-proxy] mode: ${attached ? 'badge' : 'simulator'}  serial=${serial}` +
        (attached ? '' : ' (device node not present)'),
    );
  });
}

void main();
