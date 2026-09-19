# VENDX 3-minute demo script

A hardware IoT device selling its own sensor data to an AI agent — over HTTP 402,
paid in USDC micropayments on Solana, settled in ~40 ms with no RPC call on the
device side.

---

## What you will see

```
AI agent ──GET /api/telemetry──► relay-proxy ──serial──► ESP32-C3 badge
               ← 402 + nonce                          ← real sensor data
agent pays USDC on Solana
agent ──POST /settle──► relay (signs receipt)
agent ──GET /api/telemetry + X-Payment-Receipt──► relay verifies receipt ──► 200 + data
```

The demo runs in two modes, selected automatically by whether the badge is plugged in.
The `source` field in every response tells you which is active.

---

## Prerequisites (once)

```bash
nvm use                 # pins node 22.23.2
npm install
```

---

## Path A — no badge (simulator)

```bash
npm run demo
```

What happens in order:

1. relay-proxy starts on `:3402`, generates a facilitator Ed25519 keypair in `keys/`
2. agent-buyer requests `GET /api/telemetry` — gets `402` back with a nonce
3. agent-buyer checks spend policy ($5.00/day cap), selects the 100 µUSDC offer
4. agent-buyer simulates a Solana USDC transfer (no RPC — demo only)
5. agent-buyer `POST /settle` → relay signs a receipt with the facilitator key
6. agent-buyer replays `GET /api/telemetry` with `X-Payment-Receipt` header
7. relay verifies Ed25519 signature + nonce freshness → `200` + telemetry

**Expected output:**

```
╔══════════════════════════════════════════════════════╗
║         VENDX  —  ESP32 x402 Payment Demo           ║
╚══════════════════════════════════════════════════════╝

Mode: simulator (relay-proxy in-process, no hardware)

─── AI Scraper requesting telemetry ───────────────────

  ← 402  nonce=9f2c4a1b…  expires=<unix>
  ✓ policy  amount=100 µUSDC  to=FHcgXc3Y…
  → execute  txSig=SimTx1111… (simulator)
  ← receipt  eyJ2IjoxLCJu…
  ← 200 OK

─── Telemetry received ────────────────────────────────

{
  "deviceId": "esp32-sim-001",
  "source": "simulator",
  "footTraffic": 42,
  "temperature": 22.73,
  "_sim": true,
  ...
}

╔══════════════════════════════════════════════════════╗
║  ✓  402 → pay → receipt → 200  arc complete (SIM)   ║
╚══════════════════════════════════════════════════════╝
```

**Point out:**
- The nonce is burned on use — the same receipt cannot buy a second response.
- The `_sim: true` flag. This is the simulator path, and VENDX never hides it.

---

## Path B — badge attached (real hardware)

Plug in the HTN ESP32-C3 badge at `/dev/cu.usbmodem101`. The relay detects it
automatically via `existsSync('/dev/cu.usbmodem101')`.

```bash
npm run demo
```

Same command. The relay switches to badge mode on its own.

**Expected telemetry shape (instead of the simulator response):**

```jsonc
{
  "deviceId": "htn-badge-<16-char hash>",
  "source": "badge",          // ← the field that matters
  "chip": "ESP32-C3",
  "freeHeap": 79652,          // bytes — lower (28K) when BLE is up
  "largestBlock": 65536,
  "lvglUsedPct": 16,
  "bootCount": 4,
  "resetReasons": { "0": 3, "1": 1 },
  "taskCount": 7,
  "fsBytes": 7324
}
```

**What to point out:**
- `source: "badge"` — this data came from a physical RISC-V chip over USB serial.
- `freeHeap: 79652` — with BLE idle. With BLE up it drops to ~28KB.
  At 28KB there is not enough contiguous heap for a TLS handshake, which is why
  the device delegates network access to the relay.
- The BLE MAC is published only as a SHA-256 prefix — a raw MAC is a tracking
  identifier, so it never leaves the device.
- If the badge console wedges, the relay degrades gracefully: it returns
  `source: "simulator", degradedFrom: "badge"` rather than failing a paid request.

**Performance note:** first badge read takes ~20 s (prompt sync + `radio probe`
reinitializes the BLE controller, which causes a brief chip reset and reboot).
Subsequent reads within 8 s hit the cache.

---

## Path C — web frontend

Open **https://web-rouge-six-46.vercel.app** in a browser.

| Page | What to show |
| --- | --- |
| `/` | Hero — the pitch in one screen |
| `/devices` | Device list — `source` badge shows as a coloured pill |
| `/agent` | Live agent console — runs the 402→settle→200 arc in the browser, streams each step |
| `/ledger` | On-chain settlement log (Anchor program compiled, not yet deployed on devnet) |
| `/protocol` | Wire format summary |

The web frontend fetches from the relay at runtime, so if the relay is running
locally you can set `NEXT_PUBLIC_RELAY_URL=http://localhost:3402` to point it at
your live instance.

---

## What a judge should understand

### The hardware constraint is real, not contrived

The ESP32-C3 has ~28KB free with BLE up. A TLS handshake needs 40–50KB of
contiguous heap. So the device *cannot* be an HTTPS endpoint and cannot call
Solana RPC — those two constraints are measured, not assumed, and they drive the
entire architecture:

- **No TLS on the device** → the relay is the network face
- **No Solana RPC on the device** → settlement is delegated to the facilitator
- **Stateless receipt verification** → the device holds one 32-byte Ed25519 public
  key, checks the receipt in ~40 ms, and never holds a payment history

### What the device actually verifies

```
Ed25519.verify(FACILITATOR_PUBKEY, receipt_body)
&& nonce is one we issued, unused, unexpired
&& payTo == me
&& amount >= price
&& network matches
```

A compromised relay cannot replay, redirect, or discount a payment — only
fabricate one. The facilitator trust model is explicit in `docs/PROTOCOL.md`.

### Why canonical x402, not `@x402-solana/*`

`@x402-solana/core` hardcodes a test USDC mint, is not wire-compatible with the
ecosystem, and depends on Redis. We implement v1 shapes in
`packages/vendx-protocol` — one file, zero external dependencies, direct import.
See `docs/PROTOCOL.md` for the full analysis.

### ZK compression

`solana-ledger/` is an Anchor program that commits telemetry batches (up to 64
buckets per state-root update) via Light Protocol ZK compression. One transaction
versus 64 rent-paying accounts in naive storage. The program compiles clean
(`anchor build --no-idl`); devnet deployment is a `solana program deploy` away.

---

## Quick API probe (no UI needed)

```bash
# Challenge — expect 402
curl http://localhost:3402/api/telemetry

# Health — shows mode: badge or simulator
curl http://localhost:3402/health

# Fleet list
curl http://localhost:3402/api/devices

# Spend policy state
curl http://localhost:3402/api/policy

# Settlement log
curl http://localhost:3402/api/sales
```
