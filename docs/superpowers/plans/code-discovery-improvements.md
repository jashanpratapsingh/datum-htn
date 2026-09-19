# Code Discovery Improvements Plan

Branch: varnit/code-discovery-improvements (from feat/vendx-architecture-gamma)
Target PR: → feat/vendx-architecture-gamma

## Context

This plan captures three improvements identified during a code-discovery pass over the
feat/vendx-architecture-gamma branch. All tasks are small, independent, and additive.

## Global Constraints

- Personal machine: all commits use identity `Jashan Pratap Singh <jashanpratap123@gmail.com>`
- No new packages or dependencies
- No changes to wire types (types.ts), codec, or protocol logic
- All modified packages must pass their existing typecheck/build after the change
- Do not modify docs/STATUS.md (append-only fleet log)

## Tasks

### Task 1: Update CLAUDE.md with architecture and build documentation

**File:** `CLAUDE.md`

The CLAUDE.md on this branch contains only the personal-machine-guard rules. It is missing
the project's architecture documentation, build commands, and protocol decisions — all of which
are critical for future Claude Code sessions to work effectively.

Port the following sections from the varnit/code-discovery branch's CLAUDE.md, adapted to
match the current (gamma) branch's full codebase:

**Commands section** (add before the personal machine section):

```
## Commands

​```bash
nvm use                                    # pin Node 22.23.2
npm install                                # install all workspaces
npm run build -w @vendx/protocol           # build the shared protocol package
npm test -w @vendx/agent-buyer             # run policy unit tests (4 tests)
cd relay-proxy && npm run build            # build relay-proxy
cd web && npm run build                    # Next.js production build
​```

The root package.json uses npm workspaces for packages/ and agent-buyer/.
relay-proxy/, web/ are installed independently.

There is no unified test runner yet. npm test -w @vendx/agent-buyer is the only
automated test suite.

**Import convention:** moduleResolution: bundler + "module": "ES2022" — all relative
imports in src/ files use .js extensions even though source is .ts
(e.g. import { foo } from './types.js'). All packages are ESM-only ("type": "module");
no require().

@solana/web3.js is listed as a dep in packages/vendx-protocol but is currently unused
there — reserved for agent-buyer/relay-proxy.

docs/STATUS.md is an append-only multi-agent build log. Do not edit existing entries.
```

**Architecture section** (add between Commands and personal machine section):

```
## Architecture

VENDX lets an ESP32 (or its simulator) sell sensor telemetry to AI agents over HTTP.
The payment handshake is a custom x402 v1 flow:

1. **Device** answers 402 Payment Required with a challenge body (types.ts).
2. **Buyer** pays USDC on Solana and sends the tx signature in X-PAYMENT.
3. **Relay** confirms settlement on-chain, signs a compact receipt, returns it.
4. **Buyer** re-presents the receipt in X-PAYMENT-RECEIPT.
5. **Device** verifies the Ed25519 signature offline (~40 ms) — no TLS, no RPC.

### Packages

| Path | Role |
|------|------|
| packages/vendx-protocol/ | Shared TypeScript wire types, codecs, challenge builders |
| agent-buyer/ | AI scraper: intercepts 402, checks spend policy, pays |
| relay-proxy/ | Facilitator, device simulator, settlement checker, REST API |
| firmware-vendor/ | ESP32-C3 C++ (PlatformIO): BLE sensing, on-device Ed25519 verifier |
| solana-ledger/ | Anchor program: ZK-compressed telemetry commits via Light Protocol |
| web/ | Next.js marketplace frontend (12 routes) |
| supabase/ | Supabase project config and nonce migrations |
| badge-app/ | Lua app for the Hack the North ESP32-C3 badge |

### Critical protocol decisions

**Do not use @x402-solana/*.** Wire-incompatible with canonical x402 v1 (wrong mint,
wrong payTo semantics, wrong header shapes). See docs/PROTOCOL.md.

**payTo is the wallet owner, not the ATA.** The payer derives the ATA.

**USDC mints:**
- Devnet: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (Circle official)
- Mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

**Network IDs:** solana-devnet / solana (x402 v1 spelling, not CAIP-2).

**Receipt signature covers the base64url text, not the pre-encoding JSON.**
Wire format: <body>.<sig> (both base64url). The device verifies exact on-wire bytes.

**canonicalJson sorts object keys** for TypeScript/C++ byte-level agreement.
Any new ReceiptBody field must be mirrored in firmware-vendor/src/verifier.cpp.

**relay-proxy runs on port 3402** (not 3001). See docs/RUNBOOK.md.

**agent-buyer/src/buyer.js is intentionally plain JS** — it's the runtime entry
called by scripts/demo.mjs; the TypeScript sources in src/ compile to dist/.
```

Verification: `git diff --stat` should show only CLAUDE.md changed. The file must
not duplicate personal-machine-guard section contents already present.
Commit: `docs: add architecture and build docs to CLAUDE.md`

---

### Task 2: Fix README.md missing docs links

**File:** `README.md`

The STATUS.md research session flagged this as BLOCKED for integrate:

> README.md docs table missing: BADGE.md, API.md, FEATURES.md, DEMO.md; please add four rows.

The README currently has this link bar near the top:
```
[Live demo](https://web-rouge-six-46.vercel.app) · [Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Runbook](docs/RUNBOOK.md)
```

Add the four missing docs to this bar:
- `[Badge](docs/BADGE.md)` — hardware badge quirks and screen format
- `[API](docs/API.md)` — REST endpoint reference
- `[Features](docs/FEATURES.md)` — feature overview
- `[Demo](docs/DEMO.md)` — 3-minute demo script

The updated link bar should be:
```
[Live demo](https://web-rouge-six-46.vercel.app) · [Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Runbook](docs/RUNBOOK.md) · [Badge](docs/BADGE.md) · [API](docs/API.md) · [Features](docs/FEATURES.md) · [Demo](docs/DEMO.md)
```

Verify that all four target files actually exist in docs/ before committing.

Verification: `git diff --stat` shows only README.md changed. All 4 linked files exist.
Commit: `docs: add missing BADGE, API, FEATURES, DEMO links to README`

---

### Task 3: Fix DAY_CAP duplication in relay-proxy/src/server.ts

**File:** `relay-proxy/src/server.ts`

The `GET /api/policy` handler hardcodes `const DAY_CAP = 5_000_000n` locally:

```typescript
// GET /api/policy — APEX spend policy state
if (req.method === 'GET' && pathname === '/api/policy') {
  const DAY_CAP = 5_000_000n;
  const ledger = readSpendLedger();
```

This duplicates the authoritative constant `DAY_CAP_MICRO_USDC = 5_000_000n` from
`agent-buyer/src/policy.ts`. If the cap changes, the API endpoint will silently
serve stale values.

**The fix:** remove the local constant and instead read the cap from the spend-ledger
JSON at `data/spend-ledger.json`, mirroring how `readSpendLedger()` already works.
But since `relay-proxy` and `agent-buyer` are separate packages (relay-proxy does not
import from agent-buyer), the correct fix is to **extract the cap constant** into a
shared location accessible to relay-proxy, or **hardcode it at the top of server.ts
as a module-level constant** (not buried inside the handler), clearly marked as the
same value used in policy.ts.

Specifically:
1. Add at the top of `server.ts` (near the other constants, after the imports):
   ```typescript
   /** Must match DAY_CAP_MICRO_USDC in agent-buyer/src/policy.ts. */
   const DAY_CAP_MICRO_USDC = 5_000_000n;
   ```
2. In the `GET /api/policy` handler, remove the local `const DAY_CAP = 5_000_000n;`
   and replace all uses of `DAY_CAP` in that handler with `DAY_CAP_MICRO_USDC`.

Verification:
- `npm run build -w @vendx/relay-proxy` passes (or `cd relay-proxy && npx tsc -p tsconfig.json`)
- `git diff --stat` shows only relay-proxy/src/server.ts changed
- `grep -n "DAY_CAP" relay-proxy/src/server.ts` shows the constant defined once at module level and used in the handler, not redefined locally

Commit: `fix: hoist DAY_CAP_MICRO_USDC to module level in relay-proxy server`
