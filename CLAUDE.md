## Commands

```bash
nvm use                                    # pin Node 22.23.2
npm install                                # install all workspaces
npm run build -w @vendx/protocol           # build the shared protocol package
npm test -w @vendx/agent-buyer             # run policy unit tests (4 tests)
cd relay-proxy && npm run build            # build relay-proxy
cd web && npm run build                    # Next.js production build
```

The root package.json uses npm workspaces for all sub-packages: `packages/*`, `agent-buyer`, `relay-proxy`, and `web`. Run `npm install` at the root to install everything.

There is no unified test runner yet. npm test -w @vendx/agent-buyer is the only
automated test suite.

**Import convention:** moduleResolution: bundler + "module": "ES2022" — all relative
imports in src/ files use .js extensions even though source is .ts
(e.g. import { foo } from './types.js'). All packages are ESM-only ("type": "module");
no require().

@solana/web3.js is listed as a dep in packages/vendx-protocol but is currently unused
there — reserved for agent-buyer/relay-proxy.

docs/STATUS.md is an append-only multi-agent build log. Do not edit existing entries.

---

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
| web/ | Next.js marketplace frontend |
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

---

# This is a personal machine

Owner: **Jashan Pratap Singh**. Not a work machine. Two standing rules, no exceptions:

1. **Every git command, commit, and remote uses the personal identity** —
   `Jashan Pratap Singh <jashanpratap123@gmail.com>` (or
   `88160290+jashanpratapsingh@users.noreply.github.com`), GitHub account
   `jashanpratapsingh`. The work identity — `jashansinghTT`,
   `jashansingh@tenstorrent.com`, anything `tenstorrent` — must never appear in
   a commit, a config, a remote, or a credential here.

2. **Never call a claude.ai connector** (`mcp__claude_ai_*`: Glean, Gmail,
   Slack, Atlassian, Drive, Calendar, Figma, Canva). They are work tooling. No
   work email, documents, tickets, or repositories are handled on this machine —
   if a task needs them, say so and stop.

Both are enforced by `PreToolUse` hooks; see the **personal-machine-guard**
skill for the full rules, the contamination already on disk, and how to check.

---

# VENDX project rules

## Toolchain

Homebrew's `node` is broken on this machine (`dyld: libicui18n.77.dylib not
found`). **Every** node/npm/npx/vercel/supabase command must be prefixed:

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

## The wire format has one home

`packages/vendx-protocol` is the single source of truth for the 402 challenge,
the `X-PAYMENT` header and the signed receipt. Import it. Do not redefine these
shapes in `agent-buyer`, `relay-proxy` or `web`. The C++ mirror in
`firmware-vendor/src/verifier.cpp` is the one exception, and it carries a
comment pointing back here.

We implement **canonical x402 v1**, deliberately not `@x402-solana/*` — see
`docs/PROTOCOL.md` for why. Do not "fix" this by adding those packages back.

## Never invent an API

If you are unsure of a library's surface, read its `.d.ts` in `node_modules` or
its docs. A confidently-called function that does not exist is the most
expensive mistake available here.

## Design skills

`frontend-design` and `ui-ux-pro-max` are both enabled and they contradict each
other. **`frontend-design` wins on conflict.** Use `ui-ux-pro-max` as a lookup
for font pairings, a11y rules and GSAP presets — not as a style oracle.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`). Work
happens on short-lived feature branches merged into `main` through a PR, never
directly on `main`; delete the branch after the merge.

## Honesty about what runs

Two **Hack the North ESP32-C3 badges** exist and both enumerate as
`/dev/cu.usbmodem101` — check which one is plugged in before touching it.

- The user's **conference badge** keeps its factory firmware. `relay-proxy`
  reads genuine telemetry from it over the serial console (`scripts/badge.py`),
  so the demo returns `source: "badge"` when it is plugged in and
  `source: "simulator"` when it is not.
- A **disposable badge** (USB MAC `e8:f6:0a:26:6e:94`) was reflashed on
  2026-09-19 with `firmware-vendor/` at the user's request. It serves x402 over
  WiFi itself (`source: "esp32c3"`); see RUNBOOK "Vendor node". Its factory
  image is backed up in `~/.vendx/badge-backups/`. Talk to it only through
  `scripts/vendor_console.py` (one port owner, or the chip resets).

Every payload carries `source` — always surface it, and never present a
simulated reading as hardware.

Read `docs/BADGE.md` before touching the badge. Two hard rules:

- **Never reflash or erase the conference badge.** No `write_flash`, no
  `erase_flash`, no `pio run -t upload` against it. Read-only probing only; it
  is the user's conference badge and the factory firmware must survive. The
  disposable badge (MAC above) is the only device that may be flashed.
- **Never read `identity.json` or `solana.json` into anything.** They hold
  personal contact details and a plaintext Solana private key. They are not
  telemetry, they are not test fixtures, and they never get committed.

`firmware-vendor/` is our own ESP32 firmware. It runs on the disposable badge
only — never on the conference badge. Never report a deploy, a test pass or an
on-chain settlement that did not actually happen.
