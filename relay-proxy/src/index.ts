import { createRelayServer, DEFAULT_PORT } from './server.js';
import { getKeys } from './keys.js';
import { badgeAttached, BADGE_PORT } from './badge-source.js';
import { SETTLEMENT_MODE, rpcUrl } from './facilitator.js';
import { VENDOR_WALLET } from './simulator.js';
import { getRelayIdentity } from './identity.js';
import { createStoreFromEnv } from './store/index.js';
import { startLedgerBatcher } from './ledger.js';
import { Connection, Keypair } from '@solana/web3.js';

const PORT = parseInt(process.env.RELAY_PORT ?? String(DEFAULT_PORT), 10);

// Ensure the facilitator keypair exists before accepting connections.
const keys = getKeys();
const pubHex = Buffer.from(keys.publicKey).toString('hex').slice(0, 16) + '…';
console.log(`[relay-proxy] facilitator pubkey: ${pubHex}`);

const identity = getRelayIdentity(PORT);
const store = createStoreFromEnv(process.env, identity.relayId);

// Optional vendx-zk ledger batcher. Opt-in only: it spends SOL from the authority
// key, so it needs BOTH an explicit authority and an RPC; nothing is armed by default.
function loadLedgerAuthority(): Keypair | null {
  const raw = process.env.VENDX_LEDGER_AUTHORITY;
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}
const ledgerRpc = process.env.VENDX_RPC_URL ?? process.env.VENDX_LEDGER_RPC;
const ledgerAuthority = loadLedgerAuthority();
if (ledgerRpc && ledgerAuthority) {
  const conn = new Connection(ledgerRpc, 'confirmed');
  // The store lists newest first; the ledger commits oldest first.
  startLedgerBatcher(conn, ledgerAuthority, async () =>
    [...(await store.listSales({ limit: 1000 }))].reverse(),
  ).unref();
  console.log(`[relay-proxy] ledger batcher armed  authority=${ledgerAuthority.publicKey.toBase58()}`);
}

const server = createRelayServer(PORT, { store });
server.listen(PORT, () => {
  console.log(`[relay-proxy] listening on http://localhost:${PORT}`);
  console.log(
    '[relay-proxy] routes: GET /api/telemetry  POST /settle  GET /api/devices  GET /api/sales  GET /api/earnings  GET /api/ledger  ' +
      'GET /api/policy  GET /api/directory  GET /api/me  GET /api/me/purchases  GET /health',
  );
  console.log(`[relay-proxy] relay id: ${identity.relayId.slice(0, 16)}…  label: ${identity.label}  public url: ${identity.publicUrl}`);
  console.log(
    store.kind === 'supabase'
      ? `[relay-proxy] persistence: supabase (${new URL(process.env.SUPABASE_URL ?? 'http://unknown').host}) — nonces, signatures, sales and the directory survive restarts`
      : '[relay-proxy] persistence: MEMORY — nothing survives a restart',
  );
  // Mirrors /health. The poller re-checks the port on every refresh, so a badge
  // plugged in later is picked up without a restart.
  console.log(`[relay-proxy] vendor wallet: ${VENDOR_WALLET}${process.env.VENDX_VENDOR_WALLET ? '' : ' (PLACEHOLDER — set VENDX_VENDOR_WALLET)'}`);
  console.log(
    SETTLEMENT_MODE === 'verify'
      ? `[relay-proxy] settlement: verify — receipts only for USDC transfers confirmed at ${rpcUrl('solana-devnet')}`
      : '[relay-proxy] settlement: TRUST — receipts signed without checking the chain (demo mode)',
  );
  console.log(
    badgeAttached()
      ? `[relay-proxy] mode: badge — polling ${BADGE_PORT} for genuine telemetry`
      : `[relay-proxy] mode: simulator — no badge at ${BADGE_PORT}`,
  );
});
