import { createRelayServer, DEFAULT_PORT } from './server.js';
import { getKeys } from './keys.js';
import { badgeAttached, BADGE_PORT } from './badge-source.js';
import { SETTLEMENT_MODE, rpcUrl } from './facilitator.js';
import { VENDOR_WALLET } from './simulator.js';

const PORT = parseInt(process.env.RELAY_PORT ?? String(DEFAULT_PORT), 10);

// Ensure the facilitator keypair exists before accepting connections.
const keys = getKeys();
const pubHex = Buffer.from(keys.publicKey).toString('hex').slice(0, 16) + '…';
console.log(`[relay-proxy] facilitator pubkey: ${pubHex}`);

const server = createRelayServer(PORT);
server.listen(PORT, () => {
  console.log(`[relay-proxy] listening on http://localhost:${PORT}`);
  console.log('[relay-proxy] routes: GET /api/telemetry  POST /settle  GET /health  POST /api/nodes/register  GET /api/nodes');
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
