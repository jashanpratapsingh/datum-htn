import { createRelayServer, DEFAULT_PORT } from './server.js';
import { getKeys } from './keys.js';

const PORT = parseInt(process.env.RELAY_PORT ?? String(DEFAULT_PORT), 10);

// Ensure the facilitator keypair exists before accepting connections.
const keys = getKeys();
const pubHex = Buffer.from(keys.publicKey).toString('hex').slice(0, 16) + '…';
console.log(`[relay-proxy] facilitator pubkey: ${pubHex}`);

const server = createRelayServer(PORT);
server.listen(PORT, () => {
  console.log(`[relay-proxy] listening on http://localhost:${PORT}`);
  console.log('[relay-proxy] routes: GET /api/telemetry  POST /settle  GET /health');
  console.log('[relay-proxy] mode: ESP32 simulator — no hardware required');
});
