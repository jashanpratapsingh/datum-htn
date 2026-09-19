# Comprehensive Test Suite Plan

Branch: varnit/code-discovery-improvements
Target PR: → feat/vendx-architecture-gamma

## Context

Three packages currently have no test scripts: `packages/vendx-protocol` and `relay-proxy`.
`agent-buyer` has 4 passing tests; we expand those as well.

Goals:
- Full happy-path and error-path coverage
- Edge cases for every codec, challenge, and policy function
- HTTP endpoint integration tests with real error codes
- Every error reason string verified exactly (not just "something went wrong")

## Global Constraints

- Personal machine: all commits use `Jashan Pratap Singh <jashanpratap123@gmail.com>`
- No new third-party dependencies (use `node:test`, `node:assert/strict`, built-ins only)
- Test files live in `src/` so they compile with the existing tsconfig
- Use `.js` extensions on all relative imports (NodeNext module resolution in relay-proxy and agent-buyer; bundler in protocol — still needs .js for compiled output)
- Run `npm test` for each package after implementing; all tests must pass before committing
- Do NOT modify wire types, codec logic, or server handler logic — tests only

## Tasks

---

### Task 1: Protocol package — codec and challenge tests

**Packages affected:** `packages/vendx-protocol/`

**New files:**
- `packages/vendx-protocol/src/codec.test.ts`
- `packages/vendx-protocol/src/challenge.test.ts`

**Update `packages/vendx-protocol/package.json`** — add a `test` script:
```json
"test": "tsc -p tsconfig.json && node --test dist/codec.test.js dist/challenge.test.js"
```

---

#### `codec.test.ts` — required test cases (all must pass)

Import from `'./codec.js'` and `'./types.js'` as needed.

**b64uEncode / b64uDecode:**
1. Round-trip: encode then decode returns original bytes for a variety of lengths (1, 2, 3, 4, 16, 32, 64 bytes). Use `Uint8Array` comparisons.
2. URL-safe: encoded string must not contain `+`, `/`, or `=`.
3. All-zeros: `new Uint8Array(16)` encodes to 22 chars (no padding), decodes back correctly.
4. Short inputs: 1-byte, 2-byte, 3-byte arrays each encode and decode without error.

**canonicalJson:**
5. Sorts keys alphabetically: `{ z: 1, a: 2 }` → `'{"a":2,"z":1}'`
6. Nested object keys also sorted: `{ b: { y: 1, x: 2 }, a: 3 }` → keys sorted at every depth.
7. Arrays preserved in order: `[3, 1, 2]` → `'[3,1,2]'`
8. Null literal: `null` → `'null'`
9. Primitive number: `42` → `'42'`
10. Undefined values are omitted: `{ a: 1, b: undefined }` → `'{"a":1}'`
11. Empty object: `{}` → `'{}'`

**signReceipt / verifyReceipt:**
12. Sign then verify returns the original ReceiptBody (deep equal all fields).
13. Tampered body: flip one character in `receipt.body` → `verifyReceipt` returns `null`.
14. Wrong key: generate a second `nacl.sign.keyPair()`, verify with that public key → `null`.
15. Truncated sig: `receipt.sig = receipt.sig.slice(0, -4)` → `verifyReceipt` returns `null`.
16. Empty sig: `receipt.sig = ''` → `verifyReceipt` returns `null`.
17. Verify preserves all ReceiptBody fields: v, nonce, payTo, amount, signature, network, issuedAt, expiresAt all intact after verify.

**encodeReceipt / decodeReceipt:**
18. Round-trip: encode then decode returns original `{ body, sig }`.
19. Wire format is exactly `<body>.<sig>` (exactly one dot separator, no spaces).
20. `decodeReceipt('')` returns `null`.
21. `decodeReceipt('nodot')` returns `null` (no dot).
22. `decodeReceipt('.sig')` returns `null` (body is empty — dot at start).
23. `decodeReceipt('body.')` returns `null` (sig is empty — dot at end).
24. `decodeReceipt` uses the FIRST dot only: a body containing a dot still works if the outer format is correct. (Test: if body itself contains a dot in encoded form, verify it still round-trips via encode/decode.)

**encodePaymentHeader / decodePaymentHeader:**
25. Round-trip: encode a valid `PaymentPayload`, decode it back, deep-equal.
26. `decodePaymentHeader('not-base64url!!')` returns `null`.
27. `decodePaymentHeader` of a payload with `scheme: 'other'` returns `null`.
28. `decodePaymentHeader` of a payload missing `payload.signature` returns `null`.
29. `decodePaymentHeader` of a payload missing `payload.nonce` returns `null`.

**encodeSettleHeader / decodeSettleHeader:**
30. Round-trip for a `SettleResponse` with `success: true`.
31. Round-trip for a `SettleResponse` with `success: false` and `errorReason` set.
32. `decodeSettleHeader('garbage')` returns `null`.

---

#### `challenge.test.ts` — required test cases

Import from `'./challenge.js'` and `'./types.js'`.

**usdToMicroUsdc:**
1. `usdToMicroUsdc(0.01)` === `'10000'`
2. `usdToMicroUsdc(1.0)` === `'1000000'`
3. `usdToMicroUsdc(0)` === `'0'`
4. `usdToMicroUsdc(5.0)` === `'5000000'`
5. Negative throws `RangeError`: `assert.throws(() => usdToMicroUsdc(-0.01), RangeError)`
6. `NaN` throws `RangeError`
7. `Infinity` throws `RangeError`
8. Rounding: `usdToMicroUsdc(0.000001)` === `'1'` (rounds half-up, 1 micro-USDC minimum)

**microUsdcToUsd:**
9. `microUsdcToUsd('1000000')` === `1.0`
10. `microUsdcToUsd(10000)` ≈ `0.01` (within floating-point tolerance)

**newNonce:**
11. Returns a 32-char hex string (only chars 0-9a-f, length 32).
12. Two consecutive calls return different values.

**buildChallenge:**
13. Returns object with `x402Version: 1`.
14. `accepts` has exactly one entry with `scheme: 'exact'`, `network: 'solana-devnet'` by default.
15. `accepts[0].asset` equals `USDC_MINT_DEVNET`.
16. `accepts[0].maxAmountRequired` equals `usdToMicroUsdc(priceUsd)` for the given price.
17. `nonce` is a 32-char hex string.
18. `expiresAt` is roughly `now + ttlSeconds` (within 5 seconds).
19. With `network: 'solana'`, `accepts[0].asset` equals `USDC_MINT_MAINNET`.
20. `error` field equals `'Payment Required'`.

**selectRequirements:**
21. Returns the matching `PaymentRequirements` for a valid body.
22. Returns `null` if `network` doesn't match.
23. Returns `null` if `asset` doesn't match.
24. Returns `null` if `maxAmountRequired > maxMicroUsdc` (too expensive).
25. Exactly at the limit (`maxAmountRequired === maxMicroUsdc`) still returns a match.
26. Returns `null` if `scheme` is not `'exact'`.
27. Returns `null` for an empty `accepts` array.
28. Returns the FIRST match when multiple requirements are present.

---

### Task 2: Relay-proxy server HTTP endpoint integration tests

**Package affected:** `relay-proxy/`

**New file:** `relay-proxy/src/server.test.ts`

**Update `relay-proxy/package.json`** — add a `test` script:
```json
"test": "tsc -p tsconfig.json && node --test dist/server.test.js"
```

The test file spins up `createRelayServer(0)`, binds to a random port, runs all tests against it, and closes the server. Use top-level `after()` from `node:test` for cleanup.

```typescript
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayServer } from './server.js';
import type { AddressInfo } from 'node:net';

const server = createRelayServer(0);
await new Promise<void>(resolve => server.listen(0, resolve));
const { port } = server.address() as AddressInfo;
const BASE = `http://localhost:${port}`;

after(() => new Promise<void>((resolve, reject) =>
  server.close(err => (err ? reject(err) : resolve()))
));
```

---

#### Required test cases

**Health and routing:**
1. `GET /health` → status 200, body `{ status: 'ok', mode: 'simulator' }`.
2. `GET /unknown-path-xyz` → status 404, body `{ error: 'not_found' }`.
3. `OPTIONS /api/telemetry` (CORS preflight) → status 204, response header `Access-Control-Allow-Origin: *` present.

**GET /api/telemetry — 402 path:**
4. No `X-Payment-Receipt` header → 402, body has `x402Version: 1`.
5. No `X-Payment-Receipt` → 402 body `accepts` is a non-empty array with `scheme: 'exact'`.
6. No `X-Payment-Receipt` → 402 body has `nonce` (non-empty string) and `expiresAt` (number).
7. Bad receipt (random string) → 402, body has `error` field equal to `'malformed_header'`.
8. Well-formed but bad-signature receipt → 402, `error` equals `'bad_signature'`.
   (Construct: take a valid receipt shape but sign it with a freshly-generated random key.)

**Full E2E happy path (GET → POST /settle → GET with receipt):**
9. Step 1: `GET /api/telemetry` → 402, extract `nonce` from body.
   Step 2: `POST /settle` with `{ nonce, txSignature: 'SimTx...', payTo: '<vendor-wallet>', amount: '100', network: 'solana-devnet' }` → 200, body has `receipt` (string in `<body>.<sig>` format), `success: true`.
   Step 3: `GET /api/telemetry` with `X-Payment-Receipt: <receipt>` → 200, body has `deviceId`, `timestamp`, `footTraffic`.

**Replay attack (nonce reuse):**
10. Execute the same three steps as test 9, but attempt to use the same receipt a second time after the first 200 response.
    Second `GET /api/telemetry` with the already-used receipt → 402, `error` equals `'nonce_replayed'`.

**Unknown nonce:**
11. `POST /settle` with a nonce that was never issued by a prior 402 → 200 (the facilitator just signs, it doesn't validate nonces). Then `GET /api/telemetry` with that receipt → 402, `error` equals `'nonce_unknown'`.

**POST /settle error paths:**
12. `POST /settle` with body `'not-json'` → status 400, `{ error: 'bad_json' }`.
13. `POST /settle` with `{}` (missing fields) → status 400, `error` contains `'missing_fields'`.
14. `POST /settle` with `{ nonce: 'x' }` (missing txSignature) → status 400.

**Fleet endpoints:**
15. `GET /api/devices` → 200, body has `devices` array (length ≥ 1), each device has `id`, `source`, `priceUsd`, `totalSales`, `totalEarnedMicroUsdc`.
16. `GET /api/devices/<deviceId>` where deviceId is from test 15 → 200, body has `device` and `recentSales`.
17. `GET /api/devices/no-such-device-xyz` → 404, `{ error: 'device_not_found', id: 'no-such-device-xyz' }`.
18. `GET /api/sales` → 200, body has `sales` array.
19. `GET /api/policy` → 200. Verify: `capMicroUsdc === '5000000'`, `capUsd === 5.0`, `perRequestLimitMicroUsdc === '100'`, `date` matches today's UTC date (ISO format, first 10 chars of new Date().toISOString()).
20. `GET /api/ledger` → 200. Verify: `programId` is a non-empty string, `network === 'solana-devnet'`, `deployed === false`, `entries` is an array, `compressionNote` is a non-empty string.
21. `GET /api/screen` without `VENDX_ALLOW_SCREEN` env var → 404, `{ error: 'screen_capture_disabled', hint: <non-empty string> }`.

---

### Task 3: Agent-buyer policy tests — edge case expansion

**Package affected:** `agent-buyer/`

**Append to:** `agent-buyer/src/policy.test.ts` (do not rewrite the existing 4 tests).

**Additional test cases:**

1. **Exact boundary — spending exactly the remaining amount:**
   ```
   policy.recordSpend(DAY_CAP_MICRO_USDC - 100n);
   assert.ok(policy.canSpend(100n), 'spending exactly the remaining 100 µUSDC must be allowed');
   policy.recordSpend(100n);
   assert.ok(!policy.canSpend(1n), 'cap is now exactly zero: even 1 µUSDC must fail');
   ```

2. **Cumulative spend across multiple calls:**
   Record `1_000_000n` three times. `spentToday` must equal `3_000_000n` and `remainingToday` must equal `2_000_000n`.

3. **`canSpend(0n)` always returns true on a fresh ledger:**
   Spending zero must never be refused (it is a no-op).

4. **`remainingToday` never goes negative:**
   Record more than cap (cheat by recording DAY_CAP in two separate calls, bypassing the canSpend gate). `remainingToday` must clamp to `0n`, not underflow to a large positive bigint.
   Implementation note: do two `recordSpend(DAY_CAP_MICRO_USDC / 2n)` calls, then one more `recordSpend(1_000_000n)`. Total will exceed cap. `remainingToday` must be `0n`.

5. **Corrupted ledger file resets to zero (resilience):**
   Write invalid JSON to the ledger path, construct a new `SpendPolicy`. `spentToday` must be `0n` (no throw, silent reset). This covers the `catch` branch in `loadLedger`.

6. **`recordSpend` persists across multiple calls without losing previous data:**
   Call `recordSpend(500_000n)` five times on the same instance. `spentToday` must be `2_500_000n`.

The existing 4 tests must continue to pass — do not modify them.

Verification: `npm test -w @vendx/agent-buyer` passes all 10 tests (4 existing + 6 new).
Commit: `test: expand agent-buyer policy edge cases`
