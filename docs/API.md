# VENDX relay-proxy REST API

All routes are served by `relay-proxy/src/server.ts` on port **3402** by
default (`DEFAULT_PORT`). Override with the `RELAY_PORT` environment variable.

CORS: `GET /api/telemetry` sets `Access-Control-Allow-Origin: *` on all
responses so browser-based agents can reach it directly.

---

## GET /api/telemetry

The device endpoint. Returns either a payment challenge or live telemetry,
depending on whether a valid `X-Payment-Receipt` header is present.

### Without receipt — 402 Payment Required

**Request**

```
GET /api/telemetry HTTP/1.1
```

**Response** `402 application/json`

```jsonc
{
  "x402Version": 1,
  "error": "Payment Required",
  "accepts": [{
    "scheme": "exact",
    "network": "solana-devnet",
    "maxAmountRequired": "100",           // micro-USDC string
    "resource": "/api/telemetry",
    "description": "foot traffic, 5-minute bucket",
    "mimeType": "application/json",
    "outputSchema": null,
    "payTo": "FHcgXc3YzNnq8WKcH8GaDvbKhJ4ycKxHnR7jzA8zAHU",
    "maxTimeoutSeconds": 300,
    "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",  // Circle devnet USDC
    "extra": null
  }],
  "nonce": "9f2c4a1b…",                  // 32-char hex, single-use
  "expiresAt": 1758240300                // Unix seconds
}
```

The `nonce` is stored in the relay's in-process nonce store (`nonce-store.ts`)
and burned on first use. Its TTL is 300 seconds.

Type: `PaymentRequiredBody` from `@vendx/protocol`.

### With a valid receipt — 200 OK

**Request**

```
GET /api/telemetry HTTP/1.1
X-Payment-Receipt: <body>.<sig>
```

`<body>` is a base64url-encoded `ReceiptBody` JSON string.
`<sig>` is a base64url-encoded Ed25519 signature over the body bytes.

**Response** `200 application/json`

The response shape depends on whether a real HTN badge is attached to the
relay's host machine (see `badge-source.ts`):

#### Badge attached (`source: "badge"`)

```jsonc
{
  "deviceId": "htn-badge-<deviceHash>",
  "timestamp": 1758240000,
  "source": "badge",
  "chip": "ESP32-C3",
  "deviceHash": "<sha256-prefix-of-BLE-MAC>",  // raw MAC never published
  "freeHeap": 28396,
  "largestBlock": 19456,
  "lvglUsedPct": 12,
  "bleState": 1,
  "bootCount": 4,
  "resetReasons": { "0": 3, "1": 1 },
  "taskCount": 9,
  "fsBytes": 1310720
}
```

Badge readings are cached for ~8 s (one UART cannot serve a burst). If the
console wedges, the relay degrades to the simulator response with
`"source": "simulator"`, `"degradedFrom": "badge"`, and an `"error"` string.

#### No badge attached — simulator (`source: "simulator"`)

```jsonc
{
  "deviceId": "esp32-sim-001",
  "timestamp": 1758240000,
  "footTraffic": 42,           // random 0–100
  "temperature": 22.73,
  "bucket": "5min",
  "_sim": true,
  "source": "simulator"
}
```

### With an invalid receipt — 402

```jsonc
{ "error": "bad_signature" }
```

Possible error values: `malformed_header`, `bad_signature`, `receipt_expired`,
`wrong_recipient`, `wrong_network`, `insufficient_amount`, `nonce_unknown`,
`nonce_replayed`, `nonce_expired`.

---

## POST /settle

The facilitator endpoint. The buyer calls this after executing a Solana USDC
transfer to obtain a relay-signed receipt that the device will accept.

In simulator mode the relay trusts the buyer's reported `txSignature` without
querying Solana RPC (the demo is about the receipt-verification path). A
production deploy should call `getSignatureStatuses` before signing.

**Request** `application/json`

```jsonc
{
  "nonce": "9f2c4a1b…",              // required — must match a live challenge nonce
  "txSignature": "5j7sK…",          // required — base58 Solana tx signature
  "payTo": "FHcgXc3Y…",             // optional (defaults to "")
  "amount": "100",                   // optional micro-USDC string (defaults to "0")
  "network": "solana-devnet"         // optional (defaults to "solana-devnet")
}
```

**Success** `200 application/json`

```jsonc
{
  "receipt": "<body>.<sig>",         // pass this in X-Payment-Receipt
  "success": true
}
```

Response header: `X-Payment-Response: <base64url SettleResponse>`.

`SettleResponse` shape (decoded):

```jsonc
{ "success": true, "transaction": "<txSignature>",
  "network": "solana-devnet", "payer": "simulator" }
```

**Error — bad JSON** `400 application/json`

```jsonc
{ "error": "bad_json" }
```

**Error — missing fields** `400 application/json`

```jsonc
{ "error": "missing_fields: need nonce, txSignature" }
```

**Error — settlement failure** `402 application/json`

```jsonc
{ "success": false, "errorReason": "<reason>" }
```

Types: `SettleRequest`/`SettleOk`/`SettleErr` in `relay-proxy/src/facilitator.ts`;
`SettleResponse` in `@vendx/protocol`.

---

## GET /health

```json
{ "status": "ok" | "degraded", "mode": "badge" | "simulator", "persistence": "supabase" | "memory",
  "settlement": "verify" | "trust", "relayId": "<facilitator pubkey hex>", "publicUrl": "https://relay.vendx.biz",
  "heartbeat": { "lastAt": 1789871430, "ok": true, "count": 12 } }
```

`degraded` means Supabase is configured and the last directory heartbeat
failed. `relayId` is also the relay's row id in the directory.

Liveness check.

**Response** `200 application/json`

```jsonc
{ "status": "ok", "mode": "badge" }
// or
{ "status": "ok", "mode": "simulator" }
```

`mode` reflects whether a real badge is attached at `VENDX_BADGE_PORT`. It is
`"badge"` when the serial device node exists, `"simulator"` otherwise. Source:
`badgeAttached()` in `relay-proxy/src/badge-source.ts`. Defaults:
`/dev/cu.usbmodem101` on macOS/Linux, `COM3` on Windows.

---

## GET /api/devices

Returns the device fleet (currently one device — the attached badge or simulator).

**Response** `200 application/json`

```jsonc
{
  "devices": [{
    "id": "htn-badge-<16-char-hash>",
    "source": "badge",            // or "simulator"
    "priceUsd": 0.0001,
    "freeHeap": 79652,
    "largestBlock": 65536,
    "chip": "ESP32-C3",
    "lastSeen": 1758240000,
    "totalSales": 4,
    "totalEarnedMicroUsdc": "400"
  }]
}
```

`freeHeap` and `largestBlock` are `null` in simulator mode (fields not present).

---

## GET /api/devices/:id

Single device detail with up to 50 recent sales.

**Path parameter:** `id` — URL-encoded device ID from `/api/devices`.

**Response** `200 application/json`

```jsonc
{
  "device": { /* same shape as a single entry from /api/devices */ },
  "recentSales": [ /* up to 50 sale records */ ]
}
```

**Error — not found** `404 application/json`

```jsonc
{ "error": "device_not_found", "id": "<the id you passed>" }
```

---

## GET /api/sales

All in-memory settlement records (cleared on relay restart).

**Response** `200 application/json`

```jsonc
{
  "sales": [{
    "id": "<nonce>",
    "nonce": "9f2c4a1b…",
    "amountMicroUsdc": "100",
    "timestamp": 1758240000,
    "txSignature": "SimTx1111…",
    "source": "badge"             // or "simulator"
  }]
}
```

---

## GET /api/policy

Current APEX agent spend policy state.

**Response** `200 application/json`

```jsonc
{
  "capMicroUsdc": "5000000",
  "spentMicroUsdc": "400",
  "remainingMicroUsdc": "4999600",
  "date": "2026-09-19",
  "capUsd": 5.0,
  "spentUsd": 0.0004,
  "remainingUsd": 4.9996,
  "perRequestLimitMicroUsdc": "100",
  "perVendorLimitMicroUsdc": "1000000"
}
```

Source: `data/spend-ledger.json` (written by `agent-buyer/src/policy.ts`).
Resets daily. Returns zeroed values if no spend has occurred yet.

---

## GET /api/ledger

On-chain settlement summary. The Anchor program (`solana-ledger/`) is
compile-verified; devnet deployment is a `solana program deploy` away.

**Response** `200 application/json`

```jsonc
{
  "programId": "5ECE7er8mcx67kUKMp8rMLMXN1EikbzumhJV9defAd37",
  "network": "solana-devnet",
  "deployed": false,
  "totalBuckets": 4,
  "totalSettledMicroUsdc": "400",
  "totalSettledUsd": 0.0004,
  "entries": [{
    "nonce": "9f2c4a1b…",
    "amountMicroUsdc": "100",
    "timestamp": 1758240000,
    "txSignature": "SimTx1111…",
    "source": "badge",
    "solscanUrl": "https://solscan.io/tx/SimTx1111…?cluster=devnet"
  }],
  "compressionNote": "Each batch of up to 64 buckets is committed as a single state-root update, versus 64 separate rent-paying accounts in naive storage."
}
```

Up to 20 most recent entries are returned. `deployed: false` until
`solana program deploy target/deploy/vendx_zk.so` runs against devnet.

---

## Attribution: `X-Vendx-Agent-Key`

Payment is the only access control; a key only says *who* bought, so the
website can show each account its own purchases.

- Format: `vendx_sk_` + 43 base64url characters (52 chars), minted on the
  website under **Account → Agents**. The relay stores and compares only its
  sha256; the plaintext is shown once.
- `GET /api/telemetry` (402 path): a malformed, unknown or revoked key is
  refused with **401** `{ error: "bad_agent_key" | "agent_revoked", hint }`
  before any money moves. No key → anonymous, as before.
- `POST /settle`: a bad key never fails a settle (the buyer has already paid).
  The response carries `attribution`: `agent` | `web` | `anonymous` |
  `unknown_key` | `revoked_key`.
- The website's own purchases use `X-Vendx-Web-Secret` (shared with the relay
  as `VENDX_WEB_SECRET`) plus `X-Vendx-User-Id`; they settle with
  `attribution: "web"`.

`POST /settle` is idempotent for a retry of the same `nonce` + `txSignature`:
the earlier receipt is returned with `"idempotent": true`. A settled nonce
presented with a different signature is `402 nonce_replayed`; a signature that
already bought a receipt for another nonce is `402 signature_reused`.

### `X-Vendx-Agent-Id` (with the web secret)

When the website's server buys on behalf of one of a user's agents — the remote
MCP server at `/api/mcp` does this on every `vendx_buy_reading` — it sends
`x-vendx-web-secret`, `x-vendx-user-id` **and** `x-vendx-agent-id` (a
`vendx_agents.id`). The sale is then attributed to both the account and the
agent (`vendx_sales.user_id`, `vendx_sales.agent_id`); the agent id is ignored
unless the secret matches, and a dangling id is nulled by
`vendx_record_settlement` (migration 0004) rather than failing the settlement.

## GET /api/directory

Every relay and device that has heartbeated into the store, across all relays
sharing the Supabase project. Liveness is derived from `lastSeen` by the
reader (`live` ≤ 90 s, `stale` ≤ 600 s, else `lost`).

```json
{
  "persistence": "supabase",
  "relays": [{ "id": "<facilitator pubkey hex>", "label": "jashan", "publicUrl": "https://relay.vendx.biz",
               "vendorWallet": "3Tm2…", "network": "solana-devnet", "settlement": "verify",
               "facilitatorPubkey": "<base64url>", "version": "0.1.0", "lastSeen": 1789871430, "state": "live", "ageSeconds": 4 }],
  "devices": [{ "relayId": "<hex>", "id": "esp32-sim-001", "source": "simulator", "resource": "/api/telemetry",
                "priceMicroUsdc": "100", "payTo": "3Tm2…", "network": "solana-devnet", "stats": { "freeHeap": null }, "lastSeen": 1789871430, "state": "live", "ageSeconds": 4 }]
}
```

## GET /api/me · GET /api/me/purchases?limit=50

Require `X-Vendx-Agent-Key`. `401 missing_agent_key | bad_agent_key |
agent_revoked` otherwise.

- `/api/me` → `{ agent: { id, name, keyPrefix, createdAt, lastUsedAt }, userId, persistence }`
- `/api/me/purchases` → `{ agent: { id, name }, purchases: [ SaleRecord & { receipt, solscanUrl } ] }`
  (newest first, across every relay in Supabase mode; `limit` 1–200).

## Persistence and `503 store_unavailable`

With `SUPABASE_URL` + `SUPABASE_SECRET_KEY` set, nonces, used transaction
signatures, sales and the directory live in Supabase (`supabase/migrations/`)
and survive restarts; a redeemed receipt stays redeemed. Without them the relay
runs on memory and says so at startup and in `/health`. When Supabase is
configured and a query fails, any route that needed it answers
`503 { error: "store_unavailable", op }` — the relay never silently falls back
to memory, because a nonce it cannot remember is a nonce it cannot honour.
Receipts are never included in `/api/sales`, `/api/ledger` or the public view;
only the buying agent gets them back (`/api/me/purchases`).

## Key persistence

The facilitator Ed25519 keypair is generated on first start and written to
`keys/facilitator.json` (git-ignored). The public key is logged at startup as
`[relay-proxy] facilitator pubkey loaded`. The ESP32 firmware has the matching
public key compiled in — rotating it requires a firmware rebuild.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `RELAY_PORT` | `3402` | HTTP listen port |
| `VENDX_PY` | `.venv-pio/bin/python` | Python interpreter for `scripts/badge.py` |
| `VENDX_BADGE_SCRIPT` | `scripts/badge.py` | Serial bridge script |
| `VENDX_BADGE_PORT` | `/dev/cu.usbmodem101` (macOS/Linux) or `COM3` (Windows) | USB serial device for the HTN badge |
| `VENDX_ALLOW_SCREEN` | unset | Set to enable `GET /api/screen` |
| `SUPABASE_URL` | — | Supabase project URL; with the key below, enables persistence |
| `SUPABASE_SECRET_KEY` | — | `sb_secret_…` (or legacy `SUPABASE_SERVICE_ROLE_KEY`). Relay only, never in `web/` |
| `VENDX_PUBLIC_URL` | `http://localhost:<port>` | How the directory advertises this relay (`scripts/relay.sh` sets it) |
| `VENDX_RELAY_LABEL` | hostname | Directory label |
| `VENDX_HEARTBEAT_SEC` | `30` | Directory heartbeat interval |
| `VENDX_WEB_SECRET` | — | Shared with the website so its purchases are attributed to accounts |
| `VENDX_SETTLEMENT` | `verify` | `verify`: /settle checks the USDC transfer on-chain before signing. `trust`: signs unverified (demo). |
| `VENDX_VENDOR_WALLET` | placeholder | Vendor's Solana wallet quoted as `payTo`; set it to a key you control. |
| `VENDX_SOLANA_RPC` | public devnet/mainnet | RPC endpoint used to verify payments. |
