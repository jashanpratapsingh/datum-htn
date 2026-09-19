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

`packages/vendx-protocol` (`@vendx/protocol`) is the only package with a
completed build. The other workspaces (`agent-buyer`, `relay-proxy`, `web`) will
build as their `src/` directories are populated.

## Demo arc

> **Status:** `scripts/demo.mjs` does not exist yet — it will be written by
> the `backend` and `integrate` sessions. This section documents the intended
> invocation.

```bash
npm run demo
```

The demo runs:
1. `relay-proxy` in simulator mode (fake ESP32, no hardware)
2. `agent-buyer` against the simulator
3. Full 402 → settle → verify → 200 arc, logged to stdout
4. On-chain receipt sampling logged to stdout

Expected output (once built):
```
[relay]  listening on :3001
[device] issued nonce abc123… (TTL 300s)
[buyer]  got 402 — price 10000 µUSDC, within $5.00/day cap
[buyer]  sending USDC transfer…
[relay]  confirmed tx 5j7s… on solana-devnet
[relay]  signed receipt (~378B)
[device] verified receipt in 41ms — nonce burned
[device] 200 OK — 42 BLE macs, 5-min bucket
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

No `.env` file is committed. Create `.env.local` (git-ignored) at the repo root:

```bash
# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
VENDX_NETWORK=solana-devnet

# Facilitator key (relay-proxy)
FACILITATOR_SECRET_KEY=<base58 64-byte Ed25519 secret key>
FACILITATOR_PUBLIC_KEY=<base58 32-byte Ed25519 public key>

# Buyer wallet
BUYER_SECRET_KEY=<base58 64-byte Ed25519 secret key>

# Supabase (local dev — from `supabase status` output)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<from supabase status>
SUPABASE_SERVICE_KEY=<from supabase status>

# Vercel (web frontend deploy)
NEXT_PUBLIC_RELAY_URL=https://<your-relay-proxy-url>
NEXT_PUBLIC_SUPABASE_URL=<production Supabase URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<production anon key>
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

Set the environment variables in the Vercel dashboard. The `NEXT_PUBLIC_*`
variables are baked in at build time; server-side variables (`SUPABASE_SERVICE_KEY`)
are injected at runtime.

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
