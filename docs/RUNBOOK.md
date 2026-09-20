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
# Several relays (vendors) side by side: comma-separated label=url. Takes
# precedence over NEXT_PUBLIC_RELAY_URL. Each relay keeps its own nonces, sales
# and facilitator key, so the site shows them as separate vendors and pins every
# payment to the relay that issued the 402 (web/lib/relays.ts).
NEXT_PUBLIC_RELAYS=jashan=https://relay.vendx.biz,teammate=https://<their-relay>
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

Two ESP32-C3 badges exist. The user's **conference badge** keeps its factory
firmware and is read over its serial console (`scripts/badge.py`) — never
reflash it. A second, **disposable badge** (USB MAC `e8:f6:0a:26:6e:94`) runs
`firmware-vendor/` since 2026-09-19; see "Vendor node" below. Both enumerate as
`/dev/cu.usbmodem101`, so check which one is plugged in before doing anything:
the vendor node prints `[vendx] boot device=vendx-esp32c3-6e94` on reset, the
factory badge shows a `badge> ` prompt.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
node scripts/gen-facilitator-key.mjs --device-id vendx-esp32c3-6e94   # relay pubkey -> src/facilitator_key.h
cd firmware-vendor
../.venv-pio/bin/pio run -e esp32c3            # compile
```

`pio run -t upload` is broken on this machine (esptool 5.4 logger crash inside
PlatformIO's uploader, *after* it has erased the bootloader). Flash with esptool
directly, and stop anything holding the port first (`pkill -f vendor_console.py`,
and the relay's badge poller if it is on):

```bash
B=firmware-vendor/.pio/build/esp32c3
./.venv-pio/bin/python -m esptool --chip esp32c3 --port /dev/cu.usbmodem101 --baud 460800 \
  --before default-reset --after hard-reset write-flash -z --flash-mode dio --flash-freq 80m --flash-size 4MB \
  0x0 $B/bootloader.bin 0x8000 $B/partitions.bin \
  0xe000 ~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin \
  0x10000 $B/firmware.bin
```

A backup of the disposable badge's factory bootloader + partition table + app
(storage/LittleFS deliberately excluded — it holds identity.json and solana.json)
is in `~/.vendx/badge-backups/e8f60a266e94-*/` with restore instructions.

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


## Public relay: the cloudflared tunnel

The relay must run on the laptop (it owns the badge's USB port), and Vercel's
API proxies read `NEXT_PUBLIC_RELAY_URL` at build time. With the variable unset
they point at localhost and the deployed site returns 503. The fix is a
cloudflared *quick tunnel* — no Cloudflare account needed, but the
`*.trycloudflare.com` hostname changes every time cloudflared restarts, and
each new hostname needs a Vercel env update **and a redeploy**.

```bash
scripts/relay-tunnel.sh up       # start tunnel if needed, set NEXT_PUBLIC_RELAY_URL (prod+preview), vercel --prod
scripts/relay-tunnel.sh status   # URL, relay health through the tunnel, which URL is deployed
scripts/relay-tunnel.sh down
```

State: `~/.vendx/cloudflared.log`, `~/.vendx/relay-public-url`. After a laptop
reboot run `up` again (relay first: `node relay-proxy/dist/index.js`). For a
permanent hostname, `cloudflared tunnel login` + a named tunnel replaces the
quick tunnel; the script would then only need the URL step removed.

The relay's badge poller assumes the factory console. With the vendor node
plugged in instead, start the relay with the poller pointed nowhere so it
reports `mode: simulator` honestly rather than wedging on an unknown console:

```bash
VENDX_BADGE_PORT=/dev/cu.vendx-none node relay-proxy/dist/index.js
```

## Vendor node (disposable badge running firmware-vendor)

The node serves the x402 endpoint itself on port 80 (`GET /api/telemetry`,
`GET /health`, `GET /`) and verifies relay receipts offline with the compiled-in
facilitator public key. Provenance field: `"source": "esp32c3"`.

**WiFi** is provisioned at runtime — nothing is compiled in. If no station link
is up 20 s after boot it opens its own WPA2 access point
`vendx-<last 4 of MAC>` (`vendx-6e94`, password `vendx-setup`, node at
`192.168.4.1`). Station credentials are stored in NVS via the USB console and
survive reflashes. WPA2-Enterprise networks (eduroam and the like) are **not**
supported — use a phone hotspot or the AP.

```bash
./.venv-pio/bin/python scripts/vendor_console.py tail &                # ONE process owns the port; logs to ~/.vendx/vendor-serial.log
./.venv-pio/bin/python scripts/vendor_console.py send status           # link, ip, heap, uptime, current BLE bucket
./.venv-pio/bin/python scripts/vendor_console.py send scan             # nearby networks
./.venv-pio/bin/python scripts/vendor_console.py wifi "My Hotspot" pw  # save + connect; prints ip and vendx-esp32c3-6e94.local
./.venv-pio/bin/python scripts/vendor_console.py send help
```

Never open the serial port from a second process: on the C3's USB-Serial/JTAG
the DTR/RTS toggle of a second `open()` resets the chip into download mode.
`send` goes through a FIFO to the running `tail` for exactly this reason.

End-to-end check over the network (402 → relay `/settle` → 200 → replay and
tamper both rejected):

```bash
scripts/vendor-handshake.sh http://192.168.4.1            # on the AP
scripts/vendor-handshake.sh http://vendx-esp32c3-6e94.local   # on a shared LAN
```

### Stable hostname (named tunnel)

Target: **relay.vendx.biz**. Prepared on 2026-09-19: tunnel `vendx-relay`
(id `c9dbe6fb-0523-424d-9d71-42e96565bfce`) exists in the Cloudflare account
and `~/.cloudflared/config.yml` already routes `relay.vendx.biz` →
`localhost:3402`. vendx.biz is registered at Porkbun and is **not** in the
Cloudflare account yet; the tunnel cert on this machine cannot create zones.
Remaining steps, in order:

1. Cloudflare dashboard → Add a domain → `vendx.biz` (Free plan is fine). Note
   the two nameservers it assigns.
2. Porkbun → vendx.biz → Nameservers → replace the porkbun.com ones with those
   two. Wait until `dig +short NS vendx.biz` returns them (minutes to hours).
3. Either `cloudflared tunnel login` choosing vendx.biz, then
   `cloudflared tunnel route dns vendx-relay relay.vendx.biz` — or add the DNS
   record by hand: CNAME `relay` → `c9dbe6fb-0523-424d-9d71-42e96565bfce.cfargotunnel.com`, proxied.
4. `VENDX_RELAY_HOST=relay.vendx.biz scripts/relay-tunnel.sh up` (or change the
   `NAMED_HOST` default in the script). It starts the named tunnel, re-points
   Vercel, redeploys once and stops the quick tunnel. The URL never rotates again.


## Several relays on one site

`web/lib/relays.ts` reads `NEXT_PUBLIC_RELAYS` (`label=url,label=url`). Every
page fans out to all relays and tags each device, sale and receipt with the
relay it came from; a relay that is down is reported in its own panel while the
others still render. Device links carry `relayKey:deviceId` because two
simulators share the id `esp32-sim-001`. The agent console has a relay picker,
and `/api/telemetry?relay=<key>` / `/api/settle?relay=<key>` proxy to that
relay only — a nonce exists in one relay's process, so challenge and settlement
must not be split across relays. To add a teammate:

```bash
echo 'teammate=https://their-relay.example' >> ~/.vendx/extra-relays
scripts/relay-tunnel.sh up          # rewrites NEXT_PUBLIC_RELAYS and redeploys once
```

Their relay must serve the same REST surface (docs/API.md) with CORS on.
