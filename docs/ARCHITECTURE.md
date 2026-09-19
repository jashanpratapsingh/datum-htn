# VENDX architecture

VENDX turns a $5 ESP32 into a self-sovereign economic actor: sensors sell their
own telemetry to AI agents over HTTP 402, settled in USDC on Solana, with
ZK-compressed history via Light Protocol.

## System map

```
┌──────────────────────────────────────────────────────────────────────────┐
│                               Internet                                    │
│                                                                           │
│   ┌─────────────┐    HTTP/402     ┌──────────────────────────────────┐   │
│   │  agent-buyer│ ◄────────────── │          relay-proxy             │   │
│   │  (AI buyer) │ ──────────────► │  public HTTPS · facilitator      │   │
│   └──────┬──────┘   X-PAYMENT     │  · ESP32 simulator               │   │
│          │                        └──────────────┬───────────────────┘   │
│          │                                       │ BLE / Wi-Fi           │
│          │ Solana RPC                            │                       │
│          ▼                                       ▼                       │
│   ┌──────────────┐               ┌──────────────────────────────────┐    │
│   │solana-ledger │               │        firmware-vendor           │    │
│   │Anchor program│               │  ESP32 C++: BLE scan, async      │    │
│   │ZK-compressed │               │  HTTP server, stateless verify   │    │
│   │  telemetry   │               └──────────────────────────────────┘    │
│   └──────────────┘                                                        │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │                         web (Next.js 16)                         │    │
│   │  hero · PaymentHandshake · VendorMap · TelemetryTicker ···      │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│   ┌──────────────────────────┐   ┌──────────────────────────────────┐    │
│   │   @vendx/protocol        │   │           Supabase               │    │
│   │  shared wire types ·     │   │  device registry · nonce store   │    │
│   │  codec · challenge       │   │  · settlement log                │    │
│   └──────────────────────────┘   └──────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Surfaces

### `packages/vendx-protocol` — the single source of truth

The only package every other surface imports. Contains:

| Module | Exports |
| --- | --- |
| `types.ts` | `PaymentRequiredBody`, `PaymentRequirements`, `PaymentPayload`, `SignedReceipt`, `ReceiptBody`, `SettleResponse`, `VerifyResult`, `VerifyFailure`, `VendxNetwork`, `X402_VERSION`, mint constants |
| `codec.ts` | `b64uEncode`, `b64uDecode`, `canonicalJson`, `encodePaymentHeader`, `decodePaymentHeader`, `encodeSettleHeader`, `decodeSettleHeader`, `signReceipt`, `verifyReceipt`, `encodeReceipt`, `decodeReceipt` |
| `challenge.ts` | `buildChallenge`, `selectRequirements`, `usdToMicroUsdc`, `microUsdcToUsd`, `newNonce`, `ChallengeInput` |

See [`docs/PROTOCOL.md`](PROTOCOL.md) for the wire shapes. Do not redefine them
in other packages.

### `agent-buyer/` — the AI buyer

An autonomous agent that:
1. Fetches a protected endpoint — receives `402 Payment Required`.
2. Decodes the challenge via `@vendx/protocol`.
3. Checks its APEX spend policy ($5.00 / day cap, persisted).
4. Executes the USDC transfer on Solana.
5. Submits the `X-PAYMENT` header and `X-PAYMENT-RECEIPT` to the vendor.

The buyer never touches Solana RPC itself after payment — it relies on the relay
to confirm settlement and return a signed receipt. It verifies the receipt
signature before accepting the data.

### `relay-proxy/` — the public facilitator

Three responsibilities:

1. **Routing** — accepts inbound buyer connections and proxies them to the
   correct vendor (by device-id in the path).
2. **Facilitation** — settles payments on behalf of the buyer: calls
   `getSignatureStatuses` on Solana, confirms the transfer, signs a
   `ReceiptBody` with the facilitator's Ed25519 secret key, and returns
   `<body>.<sig>` in the response.
3. **Simulator** — exposes a fake ESP32 that issues real challenges and verifies
   real receipts, so the full payment arc runs without hardware. The simulator
   uses the same verification logic as the firmware C++ mirror.

The facilitator key is the only secret the relay holds. The ESP32 firmware holds
only the matching 32-byte public key (compiled in). Rotating the key requires a
firmware update.

### `firmware-vendor/` — ESP32 C++

Runs on an ESP32. BLE scan aggregates nearby MAC addresses into a 5-minute
bucket. The async HTTP server:
- Serves `402 Payment Required` with a fresh nonce on unauthenticated requests.
- On a request with `X-PAYMENT-RECEIPT`, calls `ed25519_verify` with the
  compiled-in facilitator public key, then enforces:
  - nonce is one we issued, unused, unexpired
  - `payTo` == our wallet
  - `amount` >= our price
  - `network` matches
  - receipt not expired
- On success, returns the telemetry JSON.

The device holds **no state about payments** beyond a nonce table (small, in
RAM, evicted at TTL). No TLS client, no RPC, no CA bundle. Verification runs in
~40ms on the ESP32's Xtensa core.

`firmware-vendor/src/verifier.cpp` mirrors the type definitions in
`packages/vendx-protocol/src/types.ts` and carries a comment pointing back to
it.

### `solana-ledger/` — Anchor program

An on-chain program that accepts batched ZK-compressed telemetry commits from
the relay. Uses [Light Protocol](https://lightprotocol.com/) state compression:
instead of writing one Solana account per telemetry record (expensive rent),
the relay accumulates records, computes a ZK state root, and posts a single
compressed proof. Verifiers reconstruct the Merkle path to audit any record.

### `web/` — Next.js marketplace

Stack: Next.js 16 (App Router), Tailwind 4 (CSS-first, no `tailwind.config.js`),
TypeScript, `hls.js`, `lucide-react`.

Key views specified in [`docs/FRONTEND_BRIEF.md`](FRONTEND_BRIEF.md):

| Component | Data source |
| --- | --- |
| `<PaymentHandshake/>` | relay-proxy WebSocket events |
| `<VendorMap/>` | Supabase realtime (device registry) |
| `<TelemetryTicker/>` | Supabase realtime (settlement log) |
| `<PolicyGauge/>` | agent-buyer spend state |
| `<CompressionSavings/>` | solana-ledger program account |
| `<Explorer/>` | Solscan devnet API |

### `supabase/` — database

Supabase (Postgres + Realtime) stores:

- **Device registry** — vendor wallet, price, metadata, uptime.
- **Nonce table** — issued challenges with expiry; the relay enforces single-use.
- **Settlement log** — every settled tx signature, payer, amount, timestamp.

Local dev: `supabase start` (requires Supabase CLI). Migrations live in
`supabase/migrations/`.

## Payment handshake — step by step

```
1. Buyer  ──► Vendor  GET /api/telemetry
2. Vendor ◄── Relay   (relay proxies the connection)
3. Vendor ──► Buyer   402 Payment Required
                       body: PaymentRequiredBody {nonce, expiresAt, accepts[]}

4. Buyer checks APEX policy — spend within cap?

5. Buyer  ──► Solana  SPL token transfer (USDC, micro-units)
6. Solana ──► Buyer   tx signature (base58)

7. Buyer  ──► Relay   POST /settle  {txSig, nonce, payTo, amount}
8. Relay confirms on-chain via getSignatureStatuses
9. Relay signs ReceiptBody with Ed25519 facilitator key
10. Relay ──► Buyer  SignedReceipt: "<body>.<sig>"

11. Buyer ──► Vendor  GET /api/telemetry
                       X-PAYMENT: base64url(PaymentPayload)
                       X-PAYMENT-RECEIPT: <body>.<sig>

12. Vendor verifies: ed25519_verify(FACILITATOR_PUBKEY, body) — offline, ~40ms
                     + nonce check, amount check, expiry check

13. Vendor ──► Buyer  200 + telemetry JSON
                       X-PAYMENT-RESPONSE: base64url(SettleResponse)
```

## ZK compression flow

```
1. relay aggregates BLE telemetry records into a 5-min bucket
2. relay computes ZK state root (Light Protocol SDK)
3. relay submits compressed proof to solana-ledger Anchor program
4. Anchor program posts ZK state to Solana (single account, one period's rent)
5. Auditors reconstruct any record via Merkle path inclusion proof
```

## Trust model

The x402 model trusts the facilitator. VENDX's additions:

| What the device enforces locally | What this prevents |
| --- | --- |
| Nonce single-use | replay of a valid receipt |
| Nonce freshness (TTL) | delayed replay after nonce expiry |
| `payTo` == own wallet | receipt redirected to a different vendor |
| `amount` >= price | discounted payment accepted |
| `network` match | mainnet receipt used on devnet (or vice-versa) |
| Receipt `expiresAt` | stale facilitator-signed receipt |

A compromised relay can fabricate a receipt for a payment that never settled,
but it cannot replay, redirect, or discount a legitimate payment. The relay
samples settled receipts against `getSignatureStatuses` on a background task to
close the loop after the fact.

## Build status (2026-09-19)

| Surface | Status |
| --- | --- |
| `packages/vendx-protocol` | Built — `npm run build` passes, all types and codec functions present |
| `agent-buyer/` | Scaffolded — empty `src/`; implementation in progress |
| `relay-proxy/` | Scaffolded — empty `src/`; implementation in progress |
| `firmware-vendor/` | Scaffolded — empty `src/` and `lib/`; implementation in progress |
| `solana-ledger/` | Scaffolded — `programs/` directory present, no source yet |
| `web/` | Scaffolded — empty directory; implementation in progress |
| `supabase/` | Initialized — `config.toml` present, migrations directory created |
