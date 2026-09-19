# VENDX runbook

Operational reference: local dev, demo arc, and deploy.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22.23.2 | via nvm — see below |
| nvm | any | manages node |
| tmux | any | required for the build fleet |
| Supabase CLI | any | local DB only (`supabase start`) |
| PlatformIO CLI | any | firmware builds only (`pio run`) |

No ESP32 hardware is required for the demo — `relay-proxy` ships a device
simulator.

## Node version

Homebrew's system `node` is broken on this machine (`dyld: libicui18n.77.dylib
not found`). **Every** node/npm/npx command in this project must be prefixed:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

Or, if you have a `.nvmrc` at the repo root:

```bash
nvm use   # pins 22.23.2
```

The fleet script (`scripts/fleet.sh`) does this automatically for each session.

## Building

```bash
# from repo root, after setting PATH above
npm install          # workspace-level install (all packages)
npm run build        # builds packages/vendx-protocol (other services: in progress)
npm run typecheck    # type-check all workspaces
```

`packages/vendx-protocol` (`@vendx/protocol`), `agent-buyer`, `relay-proxy`,
and `web` all build cleanly. See [docs/ARCHITECTURE.md](ARCHITECTURE.md) for the
full build status table.

## Demo arc

```bash
npm run demo
```

The demo runs:
1. `relay-proxy` in simulator mode (fake ESP32, no hardware required)
2. `agent-buyer` against the simulator
3. Full 402 → settle → verify → 200 arc, logged to stdout

Expected output:
```
[relay-proxy] facilitator pubkey loaded
[relay-proxy] listening on :3402
[agent-buyer] wallet: <addr>…
[agent-buyer] daily budget remaining: $5.0000
[agent-buyer] → GET http://localhost:3402/api/telemetry
[agent-buyer] ← 402  nonce=<hex>…
[agent-buyer] ✓ policy  amount=100 µUSDC  to=FHcgXc3Y…
[agent-buyer] → execute  txSig=<sig>… (simulator)
[agent-buyer] → POST http://localhost:3402/settle
[agent-buyer] ← receipt  <body>.<sig>…
[agent-buyer] → GET http://localhost:3402/api/telemetry  (with receipt)
[agent-buyer] ← 200 OK — telemetry: { source: 'simulator', … }
```

## Build fleet

The fleet runs four parallel Claude Code sessions in tmux. Each session owns an
exclusive directory slice and writes only there.

```bash
./scripts/fleet.sh up               # launch all four sessions
./scripts/fleet.sh status           # per-session state + STATUS.md tail
./scripts/fleet.sh attach backend   # watch one session (ctrl-b d to detach)
./scripts/fleet.sh logs frontend    # tail that session's log file
./scripts/fleet.sh down             # kill all four
```

See [`docs/FLEET.md`](FLEET.md) for ownership rules and coordination protocol.
Session logs land in `.fleet/<session>.log`. Live build state is in
`docs/STATUS.md`:

```bash
tail -f docs/STATUS.md
```

## Environment variables

No `.env` file is committed. Create `.env.local` (git-ignored) at the repo root
with only the variables the code actually reads. Keys are **files**, not env
vars: facilitator at `keys/facilitator.json`, simulator buyer at
`data/buyer-wallet.json` (or `keys/buyer.json`), and the Solana-track wallets
at `keys/{treasury,agent,vendor}.json` (created by `npm run keygen`).

```bash
# --- Simulator relay (port 3402) ---
RELAY_PORT=3402
RELAY_URL=http://localhost:3402          # agent-buyer/src/index.ts

# --- Web (Vercel / Next.js) ---
NEXT_PUBLIC_RELAY_URL=https://<your-tunneled-relay>   # baked in at build time

# --- Solana-track spine (ports 4021 / 4022; see npm run demo:solana) ---
VENDX_NETWORK=solana-devnet
VENDX_SETTLEMENT=mock                    # or "devnet" for real USDC
VENDX_RPC_URL=https://api.devnet.solana.com
VENDX_NODE_PORT=4021
VENDX_NODE_URL=http://127.0.0.1:4021
VENDX_FACILITATOR_PORT=4022
VENDX_FACILITATOR_URL=http://127.0.0.1:4022
VENDX_ROOT=.                             # repo root for keys/
VENDX_RESOURCE=/api/telemetry
VENDX_CSI_PORT=5005
VENDX_NODE_ID=1
VENDX_ROUNDS=1
VENDX_DEMO_REPLAY=0                      # set 1 to prove nonce_replayed
VENDX_FORCE_TIER=                        # optional: MEASURED_RSSI | SIMULATED | …

# --- Badge serial (relay-proxy) ---
VENDX_PY=.venv-pio/bin/python            # Windows: path to python.exe
VENDX_BADGE_SCRIPT=scripts/badge.py
VENDX_BADGE_PORT=/dev/cu.usbmodem101     # Windows default: COM3
VENDX_SHOT_SCRIPT=scripts/badge_screen.py
VENDX_ALLOW_SCREEN=0                     # set 1 to enable GET /api/screen
```

Optional persistence (Phase 3): when set, the relay uses Supabase instead of
in-memory maps for nonces and sales. Without them, in-memory is the default.

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_KEY=<service role key>
```

The facilitator public key must match what is compiled into the firmware. Changing
it requires a firmware rebuild and re-flash.

## Supabase local dev

```bash
supabase start           # starts Postgres, Studio, Realtime on local ports
supabase status          # prints API URL, anon/service keys
supabase db reset        # re-runs migrations + seed
supabase stop            # shut down
```

Studio runs at `http://127.0.0.1:54323` by default. Migrations live in
`supabase/migrations/`.

## Firmware

No ESP32 is attached to this machine. Firmware is compile-verified only.

```bash
cd firmware-vendor
pio run                  # compile only — verify types and C++ mirror
pio run -t upload        # upload to attached ESP32 (not available here)
```

The C++ verifier in `firmware-vendor/src/verifier.cpp` mirrors the type
definitions in `packages/vendx-protocol/src/types.ts`. When you change a
`VerifyFailure` reason code or a wire field, update both files and add a comment
in `verifier.cpp` pointing to the TypeScript source.

## Vercel deploy (web)

```bash
cd web
vercel --prod
```

Set the environment variables in the Vercel dashboard. `NEXT_PUBLIC_RELAY_URL`
is baked in at build time — after changing a tunnel hostname, redeploy.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `dyld: libicui18n.77.dylib not found` on `node` | Homebrew node on PATH | `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` |
| `bad_signature` from device | Facilitator public key mismatch | Recompile firmware with correct key |
| `nonce_expired` from device | Clock skew > TTL (300s default) | Sync device clock; reduce latency between challenge and payment |
| `nonce_replayed` from device | Receipt submitted twice | Buyer should not retry with the same receipt; request a new challenge |
| `wrong_recipient` from device | `payTo` in receipt != device wallet | Confirm relay is quoting the correct vendor wallet |
| `insufficient_amount` | Buyer underpaid | Check `maxAmountRequired` in the challenge; buyer must transfer ≥ that amount |
| Protocol package missing from `node_modules` | Workspace not linked | Run `npm install` from repo root, not from inside the package directory |

## Frontend tests: two modes

```sh
cd web && npx playwright test          # relay down: 11 pass, 9 skip
# in another shell: node relay-proxy/dist/index.js
cd web && npx playwright test          # relay up:   20 pass
```

`routes.spec.ts` only ever proves each page's empty state. `relay-up.spec.ts`
runs a real handshake and loads every page populated — it **skips** (does not
pass) when the relay is unreachable, so a green relay-down run is honest about
what it did not check. Before trusting any screenshot, kill anything on `:3000`;
`playwright.config` reuses an existing server and will happily show you a stale
build.
