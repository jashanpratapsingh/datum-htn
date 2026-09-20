# VENDX wire protocol

VENDX speaks **canonical x402 v1** ([x402-foundation/x402](https://github.com/x402-foundation/x402))
with two additive extensions: a challenge **nonce**, and a facilitator-signed
**receipt** that makes on-device verification tractable.

## Why not `@x402-solana/*`

The project brief named `@x402-solana/client` and `@x402-solana/core`. We
evaluated both by reading the published tarballs and did not adopt them. Three
blocking reasons:

1. **It would reject real USDC.** `@x402-solana/core@0.3.2` hardcodes the mint
   `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` — a third-party test mint
   whose authority is itself. Circle's actual devnet USDC is
   `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. The client hard-compares
   `asset` against its own constant, so a challenge quoting real USDC is
   refused outright.
2. **It is not wire-compatible with the ecosystem.** It puts the recipient's
   *associated token account* in `payTo` where canonical x402 puts the wallet
   owner; it spells mainnet `solana-mainnet` where canonical uses `solana`; its
   payload key is `signature` or `serializedTransaction` where canonical uses
   `transaction`; its `X-PAYMENT-RESPONSE` shape is entirely different. A
   canonical `x402-fetch` client cannot pay an `@x402-solana` server.
3. **It is stale and needs Redis.** Last published ~10 months ago, single
   maintainer, pinned to `@solana/spl-token@0.3.x` (two majors behind), and its
   verifier depends on `ioredis` for the replay cache — which an ESP32 cannot be.

Canonical `x402@1.2.0` is itself a dead branch (last published 2026-04-16); the
maintained line is `@x402/core@2.26.0`, whose **v2** format renames the headers
to `PAYMENT-SIGNATURE`/`PAYMENT-RESPONSE`, switches to CAIP-2 network ids
(`solana:devnet`) and renames `maxAmountRequired` to `amount`.

**Our choice:** implement v1 shapes in [`packages/vendx-protocol`](../packages/vendx-protocol),
because v1 is what the deployed facilitators still speak, and keep the type
definitions in one file so a v2 migration is a contained edit. Everything below
is what VENDX actually sends.

## 1. Challenge — `402 Payment Required`

```jsonc
{
  "x402Version": 1,
  "error": "Payment Required",
  "accepts": [{
    "scheme": "exact",
    "network": "solana-devnet",
    "maxAmountRequired": "10000",          // micro-USDC, string
    "resource": "/api/telemetry",
    "description": "foot traffic, 5-minute bucket",
    "mimeType": "application/json",
    "outputSchema": null,
    "payTo": "FHcg…zAHU",                  // WALLET owner, not the ATA
    "maxTimeoutSeconds": 300,
    "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "extra": null
  }],
  "nonce": "9f2c…",                        // VENDX ext: single-use, hex
  "expiresAt": 1758240300                  // VENDX ext: unix seconds
}
```

The nonce is what makes replay defence possible without the device holding a
payment history. It is minted per challenge and burned on first use.

`extra` is x402 v1's escape hatch and we use it in one place: a VENDX node
(ESP32 serving this challenge itself) fills it with
`{ "deviceId", "source": "esp32c3", "facilitator": "http://…" }` so the buyer
knows which registered device minted the nonce and which relay can settle it.
The relay's own challenges leave it `null`. Buyers must treat it as advisory:
the relay signs over the node's *registered* wallet and price, not over
anything in the challenge.

## 2. Payment — `X-PAYMENT` request header

base64url of canonical JSON:

```jsonc
{ "x402Version": 1, "scheme": "exact", "network": "solana-devnet",
  "payload": { "signature": "<base58 settled tx>", "nonce": "9f2c…" } }
```

## 3. Receipt — the VENDX extension

The crux of the design. A naive reading of "stateless verification" is that the
ESP32 should verify an Ed25519 signature over the nonce — but **that proves key
possession, not payment**. A client with an empty wallet can sign a nonce all
day. Equally, having the device call Solana RPC itself means a TLS handshake
needing ~40–50KB of contiguous heap, a 10–30KB JSON parse, and seconds of
latency inside a request handler, on a part that is simultaneously running a
BLE scan on the same radio.

So settlement is delegated, and *authenticity of the settlement claim* is what
the device checks locally:

```
buyer ──► relay /settle   (relay confirms the transfer on-chain)
relay ──► buyer: "<body>.<sig>"   Ed25519-signed over the transmitted bytes
buyer ──► ESP32  X-PAYMENT-RECEIPT: <body>.<sig>
ESP32:  ed25519_verify(FACILITATOR_PUBKEY, body)   ~40ms, offline
        && nonce is one we issued, unused, unexpired
        && payTo == me && amount >= price && network matches
ESP32 ──► 200 + telemetry
```

Receipt body, base64url of canonical JSON:

```jsonc
{ "v": 1, "nonce": "9f2c…", "payTo": "FHcg…zAHU", "amount": "10000",
  "signature": "5j7s…", "network": "solana-devnet",
  "issuedAt": 1758240000, "expiresAt": 1758240300 }
```

The signature covers the **base64url text as transmitted**, not the pre-encoding
JSON. That detail matters: it means the device verifies exactly the bytes that
arrived and never has to reproduce our JSON serialization to check them. A
typical receipt is ~378 bytes on the wire.

The device holds one 32-byte public key compiled into firmware. No CA bundle, no
cert rotation, no `setInsecure()` hole, no RPC dependency.

### What this trusts

The facilitator. That is the x402 trust model, and it is stated here rather than
hidden: a dishonest relay could mint receipts for payments that never settled.
The device is not merely trusting it blindly, though — it independently enforces
nonce freshness, single use, recipient, amount and expiry, so a compromised
relay cannot replay, redirect or discount a payment, only fabricate one.
`relay-proxy` samples settled receipts against `getSignatureStatuses` on a
background task to close the loop after the fact.

## 4. Settlement — `X-PAYMENT-RESPONSE` response header

base64url of canonical JSON:

```jsonc
{ "success": true, "transaction": "5j7s…", "network": "solana-devnet",
  "payer": "9xQe…", "errorReason": null }
```

## Failure reasons

`missing_header`, `malformed_header`, `bad_signature`, `nonce_unknown`,
`nonce_replayed`, `nonce_expired`, `wrong_recipient`, `insufficient_amount`,
`wrong_network`, `receipt_expired` — all defined in
[`types.ts`](../packages/vendx-protocol/src/types.ts) and mirrored in
[`verifier.cpp`](../firmware-vendor/src/verifier.cpp).
