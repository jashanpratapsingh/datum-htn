# VENDX relay-proxy REST API

All routes are served by `relay-proxy/src/server.ts` on port **3402** by
default (`DEFAULT_PORT`). Override with the `PORT` environment variable.

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

Liveness check.

**Response** `200 application/json`

```jsonc
{ "status": "ok", "mode": "simulator" }
```

(`mode` is always `"simulator"` in the current build regardless of whether a
real badge is attached — it reflects the relay's transport mode, not the data
source.)

---

## Key persistence

The facilitator Ed25519 keypair is generated on first start and written to
`keys/facilitator.json` (git-ignored). The public key is logged at startup as
`[relay-proxy] facilitator pubkey loaded`. The ESP32 firmware has the matching
public key compiled in — rotating it requires a firmware rebuild.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3402` | HTTP listen port |
| `VENDX_PY` | `.venv-pio/bin/python` | Python interpreter for `scripts/badge.py` |
| `VENDX_BADGE_SCRIPT` | `scripts/badge.py` | Serial bridge script |
| `VENDX_BADGE_PORT` | `/dev/cu.usbmodem101` | USB serial device for the HTN badge |

## Planned endpoints (not yet landed)

The `backend` session has claimed:
- `GET /api/devices` — device registry from Supabase
- `GET /api/devices/:id` — single device detail
- `GET /api/sales` — settlement log
- `GET /api/policy` — agent-buyer spend state
- `GET /api/ledger` — solana-ledger program data

This document will be updated once those routes land in `server.ts`.
